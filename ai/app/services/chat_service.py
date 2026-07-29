import json
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from app.config.city_centers import CITY_CENTERS
from app.config.settings import settings
from app.models.schemas import ProactiveContext
from app.services.retrievers import PostgisTagRetriever, describe_candidate
from app.services.route_service import _anthropic
from app.services.weather_service import _get_forecast_by_block, _label_for_day

logger = logging.getLogger(__name__)

HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"

SESSION_TTL_SECONDS = 7200  # 2시간
MAX_HISTORY_TURNS = 40  # user+assistant 합산 40개(20턴) 초과 시 앞부분 제거
MAX_TOOL_ROUNDS = 3  # 무한 루프 방지 — 이 횟수를 넘기면 도구 없이 답변 강제

_SONNET_KEYWORDS = ("일정 바꿔", "다시 짜", "전체", "계획", "루트", "며칠")
_SEARCH_RADIUS_M = 1500
_KST = ZoneInfo("Asia/Seoul")  # 서버 컨테이너가 UTC라 국내 전용 서비스 기준 KST로 명시 변환 필요

TOOLS = [
    {
        "name": "search_nearby_places",
        "description": "현재 위치 주변 장소를 검색합니다. 사용자가 근처 맛집/카페/관광지 등을 물어보거나 대안 장소를 원할 때 사용하세요.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category_tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "검색할 카테고리 태그 배열. 예: ['#먹방', '#카페']. 특정 카테고리가 없으면 빈 배열.",
                },
                "radius_m": {
                    "type": "integer",
                    "description": "검색 반경(미터). 지정 안 하면 1500m.",
                },
            },
        },
    },
    {
        "name": "get_weather_forecast",
        "description": "여행지의 특정 날짜 날씨 예보(강수 여부)를 조회합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "조회할 날짜 (YYYY-MM-DD). 지정 안 하면 오늘.",
                },
            },
        },
    },
    {
        "name": "get_route_status",
        "description": "현재 진행 중인 여행 일정(루트) 전체 개요와 Day별 장소 목록을 조회합니다.",
        "input_schema": {"type": "object", "properties": {}},
    },
]

SYSTEM_PROMPT_TEMPLATE = """당신은 트리피(Tripy)의 여행 중 실시간 어시스턴트입니다.

[현재 여행 정보]
- 목적지: {destination}
- 기간: {start_date} ~ {end_date} ({nights}박 {nights_plus_1}일)

[규칙]
1. 도구 호출 결과에 있는 장소/정보만 답변에 사용하세요. 실제로 존재하지 않는 장소를 지어내지 마세요.
2. 도구가 필요 없는 단순 대화(인사, 잡담)는 도구 호출 없이 바로 답하세요.
3. search_nearby_places를 쓸 때, [현재 위치 추정]이 있으면 그걸 기준으로 바로 호출하세요. 추정도 없고 사용자가 위치를 말한 적도 없다면 바로 호출하지 말고 먼저 지금 어디 계신지 물어보세요.
4. 위치를 추정한 것뿐이라면(확답이 아니라면) 마치 정확히 아는 것처럼 말하지 말고 "아마", "~일 수 있어요" 같은 표현을 쓰세요.
5. 답변은 2~3문장 이내로 간결하게 하세요.
6. 사용자가 메시지에 쓴 언어로 답변하세요(한국어/영어/일본어/중국어 등 어떤 언어든). 언어가 애매하면(예: 지명만 입력) 사용자의 앱 설정 언어인 {fallback_language}로 답하세요.
7. 마크다운 문법(**볼드**, - 목록, # 제목 등)을 절대 쓰지 말고 순수 텍스트로만 답하세요 — 이 답변은 마크다운을 렌더링하지 않는 채팅 화면에 그대로 표시됩니다.
8. get_route_status 결과의 today_day/current_slot_order_index를 확인하면 그게 바로 "오늘"과 "지금 위치"입니다 — 사용자에게 며칠째인지 다시 묻지 말고, current_slot_order_index 바로 다음 순서(order)의 장소를 "다음 일정"으로 바로 답하세요. today_day가 null이면 그때만 언제 여행 중인지 물어보세요."""

# 프론트 SupportedLanguage 코드 → 프롬프트에 넣을 자연어 이름 (앱 설정 언어 폴백 힌트용)
_LANGUAGE_NAMES = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}

# ============================================================
# 프로액티브 개입 서술 조립 — type+params(검증된 ProactiveContext)를 AI 전용
# 한국어 한 줄로 만든다. 사용자에게 보이는 4개 언어 문구는 앱 proactiveText.ts가
# 만들므로 여기 한국어는 번역 대상이 아니다(AI만 읽는다).
# ============================================================

# 타입별 한 줄 설명 — app.services.proactive_service._RULES_PRE_TRIP + _RULES_DURING이
# 내보내는 type 9종과 반드시 1:1 대응해야 한다(테스트: test_gloss_covers_all_rule_types).
_INTERVENTION_GLOSS: dict[str, str] = {
    "PRE_TRIP_BRIEFING": "여행 전날 브리핑",
    "FLIGHT_DEPARTURE": "가는 편 출발 준비 안내",
    "RETURN_DEPARTURE": "오는 편 출발 준비 안내",
    "DEPARTURE_SOON": "다음 일정 출발 임박 안내",
    "EMPTY_DAY": "오늘 일정 비어있음 안내",
    "WEATHER_ALERT": "날씨 경고 안내",
    "BUDGET_OVER": "오늘 예산 초과 안내",
    "BOOKMARK_NEARBY": "근처 북마크 장소 안내",
    "FREE_GAP": "다음 일정까지 여유 시간 안내",
}

# 자유 문자열은 서술에서 뺀다 — 시스템 프롬프트에 들어갈 수 있는 유일한 주입 통로다(결함 4).
# 장소명이 필요하면 챗봇이 get_route_status로 직접 조회한다. PRE_TRIP_BRIEFING.flags 안에도
# placeName(first_slot)이 있어 중첩 dict/list까지 재귀적으로 걸러야 한다.
_FREE_TEXT_FIELDS = {"placeName", "destination", "nextPlaceName"}


def _format_proactive_value(value: object) -> str:
    """params 값 하나를 서술용 문자열로 만든다.

    dict는 '{k=v, ...}'로, list는 '[..., ...]'로 재귀 변환한다 — 자유 문자열 필드는
    어느 깊이에 있든 걸러진다(_FREE_TEXT_FIELDS). PRE_TRIP_BRIEFING.flags처럼 리스트
    안에 dict가 있는 경우가 이 재귀가 필요한 유일한 케이스다."""
    if isinstance(value, dict):
        inner = ", ".join(
            f"{k}={_format_proactive_value(v)}" for k, v in value.items() if k not in _FREE_TEXT_FIELDS
        )
        return f"{{{inner}}}"
    if isinstance(value, list):
        return "[" + ", ".join(_format_proactive_value(v) for v in value) + "]"
    return str(value)


def _build_proactive_descriptor(proactive: ProactiveContext) -> str:
    """검증된 개입(type+params)을 AI 전용 한국어 한 줄로 조립한다.

    형식: "{타입별 한 줄} (key=value, key=value, ...)". 숫자·열거·시각만 들어가고
    자유 문자열은 빠진다 — 이게 이 함수의 전부다(결함 4 핵심 회귀 지점)."""
    gloss = _INTERVENTION_GLOSS[proactive.type]
    params = proactive.model_dump(mode="json")["params"]
    fields = ", ".join(
        f"{k}={_format_proactive_value(v)}" for k, v in params.items() if k not in _FREE_TEXT_FIELDS
    )
    return f"{gloss} ({fields})" if fields else gloss


def _choose_model(user_message: str, history_len: int) -> str:
    if any(kw in user_message for kw in _SONNET_KEYWORDS):
        return SONNET_MODEL
    if history_len > 10:
        return SONNET_MODEL
    return HAIKU_MODEL


def _session_key(user_id: str, route_id: str) -> str:
    return f"chat:{user_id}:{route_id}"


async def _load_history(redis, key: str) -> list[dict]:
    if redis is None:
        return []
    try:
        raw = await redis.get(key)
        return json.loads(raw) if raw else []
    except Exception as e:
        logger.warning("Redis 히스토리 조회 오류 — 빈 히스토리로 진행: %s", e)
        return []


async def _save_history(redis, key: str, history: list[dict]) -> None:
    if redis is None:
        return
    trimmed = history[-MAX_HISTORY_TURNS:]
    try:
        await redis.setex(key, SESSION_TTL_SECONDS, json.dumps(trimmed, ensure_ascii=False))
    except Exception as e:
        logger.warning("Redis 히스토리 저장 오류 — 세션 유지 없이 진행: %s", e)


class RouteNotFoundError(Exception):
    """route_id가 없거나 user_id 소유가 아닐 때."""


async def _load_route(db: asyncpg.Pool, user_id: str, route_id: str) -> asyncpg.Record:
    row = await db.fetchrow(
        # departure_at·return_at은 프로액티브 T1(출국 준비)·RETURN_DEPARTURE(귀가 준비) 전용 —
        # 챗봇은 안 쓰지만 조회 함수를 공유하므로(proactive_service도 import) 컬럼만 추가하고
        # 반환 형태는 그대로 둔다.
        "SELECT id, destination, start_date, end_date, nights, departure_at, return_at "
        "FROM routes WHERE id = $1 AND user_id = $2",
        route_id, user_id,
    )
    if row is None:
        raise RouteNotFoundError(f"route_id={route_id} (user_id={user_id})")
    return row


def _add_minutes(t: time, minutes: int) -> time:
    return (datetime.combine(date.today(), t) + timedelta(minutes=minutes)).time()


async def _estimate_current_slot(db: asyncpg.Pool, route: asyncpg.Record) -> dict:
    """GPS 없이 서버 시각 vs route_slots.start_time만으로 '지금 있을 법한 슬롯'을 추정한다.
    confidence='high'가 아니면 좌표를 신뢰하지 말고(챗봇이 사용자에게 되묻도록) 사용한다."""
    now_kst = datetime.now(_KST)
    day_number = (now_kst.date() - route["start_date"]).days + 1
    if not (1 <= day_number <= route["nights"] + 1):
        return {"confidence": "low"}

    slots = await db.fetch(
        "SELECT rs.id AS slot_id, rs.order_index, rs.start_time, rs.duration_minutes, "
        "p.name AS place_name, "
        "ST_X(p.location::geometry) AS lng, ST_Y(p.location::geometry) AS lat "
        "FROM route_slots rs JOIN places p ON p.id = rs.place_id "
        "WHERE rs.route_id = $1 AND rs.day_number = $2 AND rs.start_time IS NOT NULL "
        "ORDER BY rs.order_index",
        route["id"], day_number,
    )
    if not slots:
        return {"confidence": "low"}

    now_t = now_kst.time()
    chosen = None
    for i, s in enumerate(slots):
        window_end = (
            slots[i + 1]["start_time"] if i + 1 < len(slots)
            else _add_minutes(s["start_time"], s["duration_minutes"] or 120)
        )
        if s["start_time"] <= now_t < window_end:
            chosen = s
            break

    if chosen is None:
        if now_t < slots[0]["start_time"]:
            chosen = slots[0]  # 첫 일정 전 — 그리로 향하는 중으로 추정
        else:
            return {"confidence": "low"}  # 마지막 일정 이후로 한참 지남 — 특정 어려움

    return {
        "confidence": "high",
        "day": day_number,
        "slot_id": str(chosen["slot_id"]),
        "order_index": chosen["order_index"],
        "place_name": chosen["place_name"],
        "coords": (float(chosen["lng"]), float(chosen["lat"])),
    }


async def _tool_search_nearby_places(
    db: asyncpg.Pool,
    route: asyncpg.Record,
    current_location: tuple[float, float] | None,
    estimated_slot: dict,
    tool_input: dict,
) -> dict:
    center = current_location
    if center is None and estimated_slot.get("confidence") == "high":
        center = estimated_slot["coords"]
    if center is None:
        center = CITY_CENTERS.get(route["destination"])
    if center is None:
        return {"places": [], "error": "위치 정보를 찾을 수 없습니다."}

    candidates = await PostgisTagRetriever(
        db=db,
        city_coords=center,
        tags=tool_input.get("category_tags") or [],
        radius_m=tool_input.get("radius_m") or _SEARCH_RADIUS_M,
    ).ainvoke("")

    top_candidates = candidates[:5]
    reasons = await _generate_place_reasons(route["destination"], top_candidates) if top_candidates else {}

    return {
        "places": [
            {
                "place_id": doc.metadata["id"],
                "name": doc.metadata["name"],
                "tags": doc.page_content.split(" | ")[-1].replace("태그: ", ""),
                "is_hidden_gem": doc.metadata["is_hidden_gem"],
                "avg_duration_minutes": doc.metadata["avg_duration_minutes"],
                "reason": reasons.get(doc.metadata["id"]) or describe_candidate(doc),
            }
            for doc in top_candidates
        ]
    }


_PLACE_REASON_SYSTEM_PROMPT = """당신은 한국 여행 전문가입니다. 주어진 장소 후보 각각에 대해 왜 가볼만한지 1문장으로 설명합니다.

출력 형식: JSON 배열 하나만 출력합니다. 다른 텍스트 없음.
[{"index": 1, "reason": "추천 이유 1문장"}, ...]

규칙:
- index는 후보 목록 각 줄 맨 앞 [N] 번호만 사용
- 후보 전체에 대해 빠짐없이 작성
- JSON 외 텍스트 절대 금지"""


async def _generate_place_reasons(destination: str, candidates: list) -> dict[str, str]:
    """검색된 후보 각각에 대해 Haiku로 1문장 추천 이유를 생성한다.
    slot_alternatives.py의 index 기반 JSON 응답 패턴을 그대로 재사용 — 환각 방지."""
    candidates_text = "\n".join(
        f"[{i + 1}] {doc.page_content}" for i, doc in enumerate(candidates)
    )
    try:
        response = await _anthropic.messages.create(
            model=HAIKU_MODEL,
            max_tokens=512,
            system=_PLACE_REASON_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"목적지: {destination}\n\n후보:\n{candidates_text}"}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json").strip()
        data = json.loads(raw)
        return {
            candidates[item["index"] - 1].metadata["id"]: item["reason"]
            for item in data
            if isinstance(item.get("index"), int) and 1 <= item["index"] <= len(candidates)
        }
    except Exception as e:
        logger.warning("챗봇 장소 추천 이유 생성 실패 — 폴백 설명 사용: %s", e)
        return {}


async def _tool_get_weather_forecast(route: asyncpg.Record, tool_input: dict) -> dict:
    coords = CITY_CENTERS.get(route["destination"])
    if coords is None or not settings.openweathermap_api_key:
        return {"error": "날씨 정보를 조회할 수 없습니다."}
    lon, lat = coords

    target_date_str = tool_input.get("date") or date.today().isoformat()
    try:
        forecast = await _get_forecast_by_block(lat, lon, settings.openweathermap_api_key)
    except Exception as e:
        logger.warning("챗봇 날씨 조회 오류: %s", e)
        return {"error": "날씨 정보를 조회할 수 없습니다."}

    day_blocks = forecast.get(target_date_str)
    if day_blocks is None:
        return {"date": target_date_str, "forecast": "5일 예보 범위 밖이라 조회 불가"}
    return {"date": target_date_str, "forecast": _label_for_day(day_blocks)}


async def _tool_get_route_status(db: asyncpg.Pool, route: asyncpg.Record, estimated_slot: dict) -> dict:
    slots = await db.fetch(
        "SELECT rs.day_number, rs.order_index, rs.start_time, rs.is_pinned, p.name AS place_name, "
        "rs.transport_to_next, rs.transport_minutes, rs.transit_summary "
        "FROM route_slots rs JOIN places p ON p.id = rs.place_id "
        "WHERE rs.route_id = $1 ORDER BY rs.day_number, rs.order_index",
        route["id"],
    )
    summaries = await db.fetch(
        "SELECT day_number, summary FROM route_day_summaries WHERE route_id = $1 ORDER BY day_number",
        route["id"],
    )
    summary_by_day = {r["day_number"]: r["summary"] for r in summaries}

    days: dict[int, dict] = {}
    for s in slots:
        day = days.setdefault(s["day_number"], {"day": s["day_number"], "summary": summary_by_day.get(s["day_number"]), "slots": []})
        day["slots"].append({
            "order": s["order_index"],
            "place_name": s["place_name"],
            "start_time": s["start_time"].isoformat() if s["start_time"] else None,
            "is_pinned": s["is_pinned"],
            "transport_to_next": s["transport_to_next"],
            "transport_minutes": s["transport_minutes"],
            "transit_summary": s["transit_summary"],
        })

    # "오늘"이 어느 Day인지 도구 결과 자체에 표시 — 시스템 프롬프트 텍스트 힌트에만 의존하면
    # 모델이 둘을 못 연결 짓고 사용자에게 며칠째인지 되묻는 문제가 있어(실측), 근거 데이터에 직접 반영한다.
    today_day = estimated_slot["day"] if estimated_slot["confidence"] == "high" else None
    today_order_index = estimated_slot["order_index"] if estimated_slot["confidence"] == "high" else None
    for day_dict in days.values():
        day_dict["is_today"] = day_dict["day"] == today_day

    return {
        "destination": route["destination"],
        "start_date": route["start_date"].isoformat(),
        "end_date": route["end_date"].isoformat(),
        "today_day": today_day,
        "current_slot_order_index": today_order_index,
        "days": [days[k] for k in sorted(days)],
    }


async def _execute_tool(
    name: str,
    tool_input: dict,
    db: asyncpg.Pool,
    route: asyncpg.Record,
    current_location: tuple[float, float] | None,
    estimated_slot: dict,
) -> dict:
    if name == "search_nearby_places":
        return await _tool_search_nearby_places(db, route, current_location, estimated_slot, tool_input)
    if name == "get_weather_forecast":
        return await _tool_get_weather_forecast(route, tool_input)
    if name == "get_route_status":
        return await _tool_get_route_status(db, route, estimated_slot)
    logger.warning("알 수 없는 도구 호출: %s", name)
    return {"error": f"알 수 없는 도구: {name}"}


async def handle_chat(
    db: asyncpg.Pool,
    redis,
    user_id: str,
    route_id: str,
    user_message: str,
    current_location: tuple[float, float] | None = None,
    language: str | None = None,
    proactive: ProactiveContext | None = None,
) -> tuple[str, list[dict] | None, dict | None]:
    """route_id가 user_id 소유가 아니면 RouteNotFoundError를 던진다.
    반환: (자연어 답변, search_nearby_places 결과 장소 목록(카드 렌더용, 없으면 None),
          확신 높은 위치 추정이 있을 때만 {slot_id, day, order_index}(카드 탭→일정 삽입 기준점, 없으면 None))"""
    route = await _load_route(db, user_id, route_id)

    session_key = _session_key(user_id, route_id)
    history = await _load_history(redis, session_key)

    model = _choose_model(user_message, len(history))
    estimated_slot = await _estimate_current_slot(db, route)
    if estimated_slot["confidence"] == "high":
        location_hint = (
            f"\n\n[현재 위치 추정] Day {estimated_slot['day']} '{estimated_slot['place_name']}' "
            "근처일 가능성이 높습니다(시간 기반 추정이라 확실친 않음)."
        )
    else:
        location_hint = (
            "\n\n[현재 위치 추정] 알 수 없습니다. 위치가 필요한 질문이면 추측하지 말고 "
            "사용자에게 지금 어디 있는지 먼저 물어보세요."
        )
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        destination=route["destination"],
        start_date=route["start_date"].isoformat(),
        end_date=route["end_date"].isoformat(),
        nights=route["nights"],
        nights_plus_1=route["nights"] + 1,
        fallback_language=_LANGUAGE_NAMES.get(language, "한국어"),
    ) + location_hint

    if proactive is not None:
        # 배너 탭 직후 첫 메시지에만 실려온다 — 유저가 "응 바꿔줘"만 보내도 뭘 바꾸란 건지
        # 알 수 있도록 방금 먼저 안내한 내용을 시스템 프롬프트에 덧붙인다. 문장은 서버가
        # 조립한다(_build_proactive_descriptor) — 자유 문자열을 빼서 프롬프트 주입 통로를
        # 없앤 게 이 수정의 핵심이다(결함 4).
        system_prompt += f"\n\n[방금 먼저 안내한 내용]\n{_build_proactive_descriptor(proactive)}"

    messages: list[dict] = [*history, {"role": "user", "content": user_message}]

    response = await _anthropic.messages.create(
        model=model,
        max_tokens=1024,
        system=system_prompt,
        messages=messages,
        tools=TOOLS,
    )

    last_places: list[dict] | None = None
    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = await _execute_tool(block.name, block.input, db, route, current_location, estimated_slot)
                if block.name == "search_nearby_places" and result.get("places"):
                    last_places = result["places"]
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})
        response = await _anthropic.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
            tools=TOOLS,
        )

    reply = "".join(block.text for block in response.content if block.type == "text").strip()
    if not reply:
        reply = "죄송해요, 지금은 답변을 드리기 어려워요. 다시 한번 말씀해 주시겠어요?"

    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply})
    await _save_history(redis, session_key, history)

    insertion_anchor = (
        {
            "slot_id": estimated_slot["slot_id"],
            "day": estimated_slot["day"],
            "order_index": estimated_slot["order_index"],
        }
        if estimated_slot["confidence"] == "high"
        else None
    )
    return reply, last_places, insertion_anchor

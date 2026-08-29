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
        # 삽입 위치 얘기를 도구 설명 본문에도 적는 이유: 규칙 목록(시스템 프롬프트)에만
        # 적어뒀더니 모델이 "한강레져스포츠 가기 전에"라고 명시된 요청에도 insert_* 인자를
        # 비워 보내는 게 실측됐다(들쭉날쭉). 모델은 도구 설명을 훨씬 무겁게 읽는다.
        "description": (
            "현재 위치 주변 장소를 검색합니다. 사용자가 근처 맛집/카페/관광지 등을 물어보거나 "
            "대안 장소를 원할 때 사용하세요. "
            "사용자가 특정 장소를 입에 올렸다면 어떤 표현이든('경복궁 근처', '남산공원 주변', "
            "'고척 스카이돔 가기 전에', '인사동 다음에') origin=\"place\", "
            "origin_place=\"그 장소명\"으로 호출하세요 — 어디 있는지 되묻지 마세요. "
            "사용자가 '경복궁 가기 전에', '경복궁 다음에', '2일차에'처럼 요청을 일정상의 특정 "
            "위치와 연결해 말했다면 insert_before_place / insert_after_place / insert_day 인자를 "
            "반드시 함께 채우세요 — 앱이 그 자리를 추천 위치로 띄웁니다. 비워 보내면 사용자가 "
            "말한 자리를 잃어버립니다."
        ),
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
                "origin": {
                    "type": "string",
                    "enum": ["current", "accommodation", "place"],
                    "description": "검색 기준점. '숙소 근처'/'호텔 주변'처럼 숙소 기준이면 'accommodation'. '경복궁 근처'처럼 일정에 있는 장소 기준이면 'place'(origin_place도 함께). 그 외에는 생략(현재 위치 기준).",
                },
                "origin_place": {
                    "type": "string",
                    "description": "origin='place'일 때 기준이 될 장소명. 사용자가 말한 그대로 넣으세요(다른 날 일정의 장소여도 됩니다 — 어느 날인지는 서버가 찾습니다).",
                },
                "insert_day": {
                    "type": "integer",
                    "description": "사용자가 '2일차에'처럼 날짜를 지정했으면 그 숫자.",
                },
                "insert_before_place": {
                    "type": "string",
                    "description": "'경복궁 가기 전에'처럼 특정 장소 앞을 지정했으면 그 장소명.",
                },
                "insert_after_place": {
                    "type": "string",
                    "description": "'경복궁 다음에'처럼 특정 장소 뒤를 지정했으면 그 장소명.",
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
- 오늘: {today_label}

[규칙]
1. 도구 호출 결과에 있는 장소/정보만 답변에 사용하세요. 실제로 존재하지 않는 장소를 지어내지 마세요.
2. 도구가 필요 없는 단순 대화(인사, 잡담)는 도구 호출 없이 바로 답하세요.
3. search_nearby_places를 쓸 때, 사용자가 "숙소 근처"처럼 숙소를 기준으로 물으면 origin="accommodation"으로 호출하세요 — 숙소가 어디인지 사용자에게 되묻지 마세요. **사용자가 특정 장소를 입에 올렸다면 어떤 표현이든**("남산공원 근처", "경복궁 주변", "고척 스카이돔 가기 전에", "인사동 다음에") origin="place", origin_place="그 장소명"으로 호출하세요 — 이때는 지금 어디 있는지 **절대 되묻지 마세요.** 그 장소가 일정에 있는지 없는지 확인할 필요도 없습니다(서버가 찾습니다). 그 외에는 [현재 위치 추정]이 있으면 그걸 기준으로 바로 호출하세요. 사용자가 장소를 말한 적도 없고 추정도 없을 때만 지금 어디 계신지 물어보세요.
4. 위치를 추정한 것뿐이라면(확답이 아니라면) 마치 정확히 아는 것처럼 말하지 말고 "아마", "~일 수 있어요" 같은 표현을 쓰세요.
5. 답변은 2~3문장 이내로 간결하게 하세요.
6. 사용자가 메시지에 쓴 언어로 답변하세요(한국어/영어/일본어/중국어 등 어떤 언어든). 언어가 애매하면(예: 지명만 입력) 사용자의 앱 설정 언어인 {fallback_language}로 답하세요.
7. 마크다운 문법(**볼드**, - 목록, # 제목 등)을 절대 쓰지 말고 순수 텍스트로만 답하세요 — 이 답변은 마크다운을 렌더링하지 않는 채팅 화면에 그대로 표시됩니다.
8. get_route_status 결과의 today_day/current_slot_order_index를 확인하면 그게 바로 "오늘"과 "지금 위치"입니다 — 사용자에게 며칠째인지 다시 묻지 말고, current_slot_order_index 바로 다음 순서(order)의 장소를 "다음 일정"으로 바로 답하세요. today_day가 null이어도 위 [현재 여행 정보]의 "오늘"이 며칠차인지 알려주므로, 여행 중인지 아닌지를 사용자에게 되묻지 마세요 — today_day가 null인 건 "지금 어느 장소에 있는지" 모른다는 뜻이지 여행 중이 아니라는 뜻이 아닙니다.
9. 숙소 정보는 get_route_status의 accommodations와 각 day의 accommodation에 있습니다. 숙소를 사용자에게 되묻기 전에 이 도구를 먼저 호출하세요. 검색 결과의 origin.date_matched가 false면 그 숙소가 오늘 날짜와 맞지 않는다는 뜻이므로 "등록하신 OO 기준으로"처럼 근거를 밝히고 답하세요.
10. 사용자가 장소 추천을 일정상의 위치와 연결해 말하면 search_nearby_places의 insert_* 인자를 반드시 채우세요. "A 가기 전에"→insert_before_place="A", "A 다음에"→insert_after_place="A", "N일차에"→insert_day=N. 사용자가 말한 장소명을 그대로 넣으세요(오늘 일정에 없는 다른 날 장소여도 그대로 넣습니다 — 어느 날인지는 서버가 찾습니다). 위치를 말하지 않았으면 비워두세요.
11. 검색 결과의 origin.expanded가 true면 요청한 반경 안에 조건에 맞는 장소가 없어서 더 멀리까지 찾은 것입니다. 이때는 "근처에는 없어서 조금 떨어진 곳을 찾았어요"처럼 사실을 밝히고, 각 장소의 distance_m을 km로 바꿔 함께 알려주세요(예: 5100 → "5.1km"). 그냥 "근처"라고만 말하면 안 됩니다. 단 search_radius_m 같은 내부 수치를 "반경 1500m"처럼 그대로 말하지는 마세요 — 사용자에게는 기술 용어입니다. expanded가 false면 거리를 굳이 언급하지 않아도 됩니다.
12. 검색 결과의 origin.kind는 실제로 어디를 기준으로 찾았는지입니다 — "place"면 origin.name 장소 기준, "accommodation"이면 그 숙소 기준, "current"면 현재 위치(추정) 기준입니다. 사용자가 특정 장소를 말했더라도 kind가 "current"로 왔다면 그 장소를 일정에서 찾지 못한 것이므로 "OO 기준으로 찾았어요"라고 말하지 마세요."""

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
    "LAST_TRANSIT": "숙소행 막차 임박 안내",
    "CLOSED_DAY": "오늘 휴관 안내",
    "BREAK_TIME": "브레이크타임 임박 안내",
    "RESERVATION_WALL": "예약 필수 안내",
    "PAYMENT_WALL": "결제 수단 제약 안내",
    "LAST_ENTRY": "마감 임박 입장 안내",
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
    if isinstance(value, datetime):
        # KST로 바꿔 넣는다. 규칙은 DB에서 온 UTC aware 값을 그대로 내보내는데, LLM은
        # 오프셋을 계산하지 않고 앞의 숫자를 그대로 읽는다. 배너는 기기 로컬(KST)로
        # 보여주므로 변환하지 않으면 같은 개입인데 배너와 챗봇이 9시간 다른 시각을 말한다.
        return value.astimezone(_KST).strftime("%Y-%m-%d %H:%M")
    if isinstance(value, time):
        # route_slots.start_time은 tz 없는 KST 벽시계 값이라 변환하지 않는다.
        return value.strftime("%H:%M")
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
    # mode="json"을 쓰면 Pydantic이 datetime을 ISO 문자열로 바꿔버려 KST 변환 분기를
    # 못 탄다 — 파이썬 객체 그대로 받아 _format_proactive_value가 직접 포맷한다.
    params = proactive.model_dump()["params"]
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


async def _load_accommodations(db: asyncpg.Pool, route_id: str) -> list[dict]:
    """루트의 숙소 전부를 체크인 순으로. 좌표는 검색 기준점으로 바로 쓸 수 있게 (lng, lat)
    분리해서 담는다. 프로액티브 _load_stay_distances와 같은 테이블을 보지만, 저쪽은
    '거리'만 필요해 PostGIS 거리 계산을 하고 이쪽은 '어디인지'가 필요해 좌표·이름·날짜를
    가져온다."""
    rows = await db.fetch(
        "SELECT name, check_in_date, check_out_date, "
        "ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat "
        # id까지 정렬 기준에 넣는 이유: 같은 날짜에 숙소가 중복 등록돼도(검증 없음)
        # 순서가 요청마다 흔들리지 않고 항상 고정된다 — 답이 매번 바뀌는 게 최악이다.
        "FROM accommodations WHERE route_id = $1 ORDER BY check_in_date, id",
        route_id,
    )
    return [
        {
            "name": r["name"],
            "check_in_date": r["check_in_date"],
            "check_out_date": r["check_out_date"],
            "lng": float(r["lng"]),
            "lat": float(r["lat"]),
        }
        for r in rows
    ]


def _resolve_stay(accommodations: list[dict], today: date) -> dict | None:
    """오늘 밤 묵는 숙소를 정한다. 순수 함수 — DB 접근 없음.

    날짜로 못 정하면 '숙소가 정확히 1곳뿐일 때만' 그걸 쓰고 date_matched=False로
    표시한다 — 근거가 약하다는 걸 모델이 알아야 "등록하신 OO 기준으로"처럼 조용히
    맞는 척하지 않고 근거를 밝힌 표현을 쓴다. 숙소가 여러 곳인데 날짜가 안 맞으면
    임의로 하나를 고르지 않고 None을 반환한다 — 특정 불가는 특정 불가로 남긴다.

    _estimate_current_slot의 day를 쓰지 않고 오늘 날짜를 직접 쓰는 이유: 슬롯 추정은
    start_time이 있는 슬롯이 없으면 실패하는데, 숙소는 일정이 비어 있어도 정해져 있다
    — 불필요한 실패 의존을 만들지 않는다."""
    for a in accommodations:
        if a["check_in_date"] <= today < a["check_out_date"]:
            return {**a, "date_matched": True}
    if len(accommodations) == 1:
        return {**accommodations[0], "date_matched": False}
    return None


async def _tool_search_nearby_places(
    db: asyncpg.Pool,
    route: asyncpg.Record,
    current_location: tuple[float, float] | None,
    estimated_slot: dict,
    tool_input: dict,
) -> dict:
    origin = tool_input.get("origin")
    center: tuple[float, float] | None = None
    origin_info: dict | None = None

    if origin == "accommodation":
        # enum 밖의 값은 이 비교에서 자연히 else로 떨어진다 — 분기 자체가 화이트리스트라
        # 별도 검증 코드를 넣지 않는다.
        stay = _resolve_stay(await _load_accommodations(db, route["id"]), datetime.now(_KST).date())
        if stay is None:
            # 예외를 던지면 대화가 끊긴다 — 빈 결과 + 안내 문구로 모델이 자연스럽게 대응하게 한다.
            return {"places": [], "error": "등록된 숙소가 없어 숙소 기준으로 찾을 수 없습니다."}
        center = (stay["lng"], stay["lat"])
        origin_info = {"kind": "accommodation", "name": stay["name"], "date_matched": stay["date_matched"]}
    elif place_hint := _origin_place_hint(tool_input):
        # "남산공원 근처 카페" / "고척 스카이돔 가기 전에 카페" — 일정에 있는 장소를
        # 기준점으로 쓴다. 이 분기가 없어서 사용자가 장소를 명시했는데도 챗봇이
        # "지금 어디 계신지" 되묻고 있었다.
        #
        # 이름→슬롯 해석은 insert_before_place용으로 이미 검증된 _match_slot을 그대로 쓴다.
        slot = _match_slot(
            await _load_route_slots(db, route["id"]),
            place_hint,
            tool_input.get("insert_day"),
            (datetime.now(_KST).date() - route["start_date"]).days + 1,
        )
        if slot is not None:
            center = (float(slot["lng"]), float(slot["lat"]))
            # 모델이 보낸 문자열이 아니라 DB 슬롯 이름을 돌려준다 — 클라이언트/모델 문자열을
            # 그대로 되돌려주지 않는 원칙(proactiveContext에서 겪고 막은 문제와 같다).
            origin_info = {"kind": "place", "name": slot["place_name"]}
        # 매칭 실패(장소명 없음·환각)면 center가 None으로 남아 아래 현재 위치 경로로
        # 내려간다 — 예외를 던지거나 빈 결과를 내지 않는다(FFE #1, #2).

    if center is None:
        center = current_location
        if center is None and estimated_slot.get("confidence") == "high":
            center = estimated_slot["coords"]
        if center is None:
            center = CITY_CENTERS.get(route["destination"])
        if center is None:
            return {"places": [], "error": "위치 정보를 찾을 수 없습니다."}
        # origin="place"로 왔지만 매칭에 실패한 경우도 여기로 떨어진다. kind를 "current"로
        # 정직하게 내려야 모델이 "남산공원 기준으로 찾았어요"라고 단정하지 않는다.
        origin_info = {"kind": "current"}

    radius_m = tool_input.get("radius_m") or _SEARCH_RADIUS_M
    candidates = await PostgisTagRetriever(
        db=db,
        city_coords=center,
        tags=tool_input.get("category_tags") or [],
        radius_m=radius_m,
        # "근처"가 목적 자질이라 반경 안 무작위면 안 된다 — 숙소 기준 카페 검색이
        # 5.1km와 27.3km(인천)를 나란히 반환한 게 실측됐다.
        sort="distance",
    ).ainvoke("")

    top_candidates = candidates[:5]

    return {
        "places": [
            {
                "place_id": doc.metadata["id"],
                "name": doc.metadata["name"],
                "tags": doc.page_content.split(" | ")[-1].replace("태그: ", ""),
                "is_hidden_gem": doc.metadata["is_hidden_gem"],
                "avg_duration_minutes": doc.metadata["avg_duration_minutes"],
                "distance_m": round(doc.metadata["distance_m"]),
                # 카드 문구는 LLM을 부르지 않고 결정론적으로 만든다. 한때 후보 5곳을 Haiku에
                # 한 번 더 보내 추천 이유를 받았는데(톤이 풍부하다는 이유로 도입), 그 왕복
                # 때문에 한 요청에 LLM 호출이 3회가 되어 Spring의 15초 타임아웃을 자주 넘겼다
                # — 카드가 아예 안 뜨는 쪽이 문구가 단조로운 쪽보다 훨씬 나쁘다.
                # describe_candidate는 이제 거리를 담으므로 처음 버전보다는 정보가 있다.
                "reason": describe_candidate(doc),
            }
            for doc in top_candidates
        ],
        # 모델이 "남산힐호텔 근처에서 찾았어요"처럼 기준점을 밝힐 수 있게 함께 반환한다.
        # expanded는 서버가 판단해서 넘긴다 — 모델에게 거리 숫자를 반경과 비교시키면
        # 들쭉날쭉해진다("판단은 규칙이, 표현은 모델이").
        "origin": {
            **origin_info,
            "search_radius_m": radius_m,
            "expanded": any(d.metadata["distance_m"] > radius_m for d in top_candidates),
        },
    }


# 후보 5곳을 Haiku에 한 번 더 보내 추천 이유를 받던 _generate_place_reasons를 제거했다
# (2026-07-30). 한 챗봇 요청의 LLM 왕복이 3회가 되어 Spring의 15초 타임아웃을 자주 넘겼고,
# 그러면 카드가 아예 안 뜬다. 문구는 describe_candidate(retrievers.py)가 결정론적으로 만든다 —
# 슬롯 대안 추천이 쓰는 것과 같은 함수라 두 화면의 문구 방식이 오히려 일치한다.


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
    accommodations = await _load_accommodations(db, route["id"])

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
        # Day N의 날짜 = start_date + (N-1)일 — _load_stay_distances의 date-range 조인과 동일 기준.
        # date_matched=True일 때만 이름을 채운다. 여기서 "1곳 폴백"까지 쓰면 "모든 Day의
        # 숙소가 남산힐호텔"이라는 틀린 단정이 된다 — 폴백은 검색 기준점(_tool_search_nearby_places)
        # 한정이다. 최상위 accommodations에 전체 목록이 있으니 모델은 무엇이 등록됐는지 항상 본다.
        day_date = route["start_date"] + timedelta(days=day_dict["day"] - 1)
        stay = _resolve_stay(accommodations, day_date)
        day_dict["accommodation"] = stay["name"] if stay and stay["date_matched"] else None

    return {
        "destination": route["destination"],
        "start_date": route["start_date"].isoformat(),
        "end_date": route["end_date"].isoformat(),
        "today_day": today_day,
        "current_slot_order_index": today_order_index,
        "accommodations": [  # 좌표는 제외 — 모델에 불필요
            {
                "name": a["name"],
                "check_in_date": a["check_in_date"].isoformat(),
                "check_out_date": a["check_out_date"].isoformat(),
            }
            for a in accommodations
        ],
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


def _origin_place_hint(tool_input: dict) -> str | None:
    """검색 기준점으로 쓸 일정 장소명을 tool_input에서 뽑는다. 없으면 None.

    `origin_place`만 보지 않고 `insert_before_place`/`insert_after_place`까지 받는 이유:
    "고척 스카이돔 가기 전에 카페 들르고 싶어"는 **검색 기준점과 삽입 자리가 같은 장소**를
    가리키는 한 문장인데, 모델에게 두 인자를 일관되게 채우라고 요구하면 한쪽만 채우거나
    둘 다 비운다(실측: 이 문장에 origin을 안 채워 "지금 어디 계신지" 되물었다).
    신호는 하나로 받고 두 판단을 서버가 유도하는 쪽이 흔들리지 않는다.

    빈 문자열을 걸러내는 게 중요하다(FFE #1) — `_match_slot`의 부분 일치 조건이
    `name in place_name`이라 빈 문자열은 모든 슬롯에 걸려 엉뚱하게 첫 슬롯이 기준점이 된다."""
    for key in ("origin_place", "insert_before_place", "insert_after_place"):
        value = tool_input.get(key)
        if value:
            return value
    return None


async def _load_route_slots(db: asyncpg.Pool, route_id) -> list[asyncpg.Record]:
    """루트의 전체 슬롯을 Day·순서대로. 좌표까지 함께 뽑는 이유는 삽입 자리 결정
    (_resolve_insertion)과 검색 기준점 결정(origin="place")이 같은 목록을 필요로 하는데,
    후자만 좌표를 쓰기 때문이다 — 쿼리를 둘로 나누면 두 판단이 서로 다른 슬롯 집합을 보게
    될 수 있다."""
    return await db.fetch(
        "SELECT rs.id AS slot_id, rs.day_number, rs.order_index, p.name AS place_name, "
        "ST_X(p.location::geometry) AS lng, ST_Y(p.location::geometry) AS lat "
        "FROM route_slots rs JOIN places p ON p.id = rs.place_id "
        "WHERE rs.route_id = $1 ORDER BY rs.day_number, rs.order_index",
        route_id,
    )


def _norm_place_name(name: str) -> str:
    """장소명 비교용 정규화 — 공백을 모두 없애고 소문자로.

    실측: 사용자가 "초안산 캠핑장 가기 전에"라고 말하면 모델도 띄어쓴 그대로 넘기는데
    DB 표기는 "초안산캠핑장"(붙임)이라 정확 일치도 부분 일치도 전부 실패했다
    (`"초안산 캠핑장" in "초안산캠핑장"`도, 그 반대도 거짓이다). 공백 하나 때문에
    검색 기준점과 삽입 자리가 동시에 엉뚱한 곳으로 떨어졌다.

    소문자화는 "ETF베이커리"처럼 영문이 섞인 이름에서 모델이 대소문자를 바꿔 보내는
    경우를 함께 흡수한다."""
    return "".join(name.split()).lower()


def _match_slot(
    slots: list[asyncpg.Record], name: str, day: int | None, today_day_number: int
) -> asyncpg.Record | None:
    """힌트 장소명 하나를 루트 슬롯 중 하나로 좁힌다. day가 주어지면 그 Day로 먼저
    좁혀서 같은 이름이 여러 Day에 걸쳐 있어도(FFE #2) 애초에 후보가 하나로 줄어들게
    한다. 이름은 정확 일치를 우선하고, 없으면 부분 일치로 넓힌다(모델이 "경복궁"만
    말해도 슬롯 이름이 "경복궁 정문"이어도 걸리게). 그래도 여러 개 남으면 "오늘 이후
    첫 번째"를 고른다 — 같은 이름이 반복 등장할 때 사용자가 말한 건 보통 아직 안 가본
    다음 방문이다. 매칭이 아예 없으면 None(호출부가 ②로 내려간다 — FFE #1, 환각
    장소명 방어. 여기서 예외를 던지지 않는다)."""
    pool = [s for s in slots if s["day_number"] == day] if day is not None else slots
    target = _norm_place_name(name)
    exact = [s for s in pool if _norm_place_name(s["place_name"]) == target]
    candidates = exact or [
        s for s in pool
        if target in _norm_place_name(s["place_name"]) or _norm_place_name(s["place_name"]) in target
    ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    candidates_sorted = sorted(candidates, key=lambda s: (s["day_number"], s["order_index"]))
    for s in candidates_sorted:
        if s["day_number"] >= today_day_number:
            return s
    return candidates_sorted[0]  # 전부 오늘 이전이면 그냥 가장 이른 Day — 항상 하나로 고정된다


def _prev_slot(slots: list[asyncpg.Record], slot: asyncpg.Record) -> asyncpg.Record | None:
    """같은 Day에서 slot 바로 앞 슬롯을 찾는다. 없으면(slot이 그 Day 첫 슬롯) None —
    '~ 가기 전에'가 첫 일정을 가리킬 때 맨 앞 삽입을 표현하는 유일한 방법이다."""
    same_day_before = [
        s for s in slots if s["day_number"] == slot["day_number"] and s["order_index"] < slot["order_index"]
    ]
    return max(same_day_before, key=lambda s: s["order_index"]) if same_day_before else None


def _last_slot_of_day(slots: list[asyncpg.Record], day: int) -> asyncpg.Record | None:
    same_day = [s for s in slots if s["day_number"] == day]
    return max(same_day, key=lambda s: s["order_index"]) if same_day else None


def _resolve_from_conversation(
    slots: list[asyncpg.Record], hint: dict, today_day_number: int, nights: int
) -> dict | None:
    """대화 힌트(①)만으로 자리를 정한다. 실패하면 None을 돌려주고 호출부가 ②로
    내려간다 — 여기서 아무것도 예외로 던지지 않는 게 FFE #1 방어의 전부다.

    before/after 둘 다 있으면 before를 우선한다(둘 다 오는 경우가 드물어 우열보다
    '항상 같은 쪽이 이긴다'는 결정성이 더 중요하다).

    장소 매칭에 실패해도 day가 유효하면 그 Day 맨 뒤로 물러난다 — 통째로 포기하지
    않는다. insert_day는 장소와 독립된 신호라서, "2일차에 경복궁 가기 전에"에서
    경복궁을 못 찾았다고 사용자가 명시한 '2일차'까지 버리면 ③으로 내려가 엉뚱하게
    '오늘 Day'를 제안하게 된다 — 날짜가 틀리는 쪽이 자리가 덜 정확한 쪽보다 훨씬
    눈에 띈다. 앱이 확인 시트로 자리를 보여주고 확정받으므로 덜 정확한 제안의 비용은
    싸다. 장소도 day도 못 건지면 그때 None을 돌려 ②로 내려간다(FFE #1).

    두 경로의 source가 다르다 — 장소를 찾았으면 "conversation"(자리가 하나로 확정),
    day만 건졌으면 "conversation_day"(서버가 고른 자리). 앱은 앞의 것만 확인 시트를
    생략하고 바로 삽입한다."""
    day = hint.get("insert_day")
    if day is not None and not (1 <= day <= nights + 1):
        day = None  # FFE #3 — 모델이 준 Day가 범위 밖이면 신뢰하지 않는다

    before = hint.get("insert_before_place")
    after = hint.get("insert_after_place")

    target = before or after
    if target:
        slot = _match_slot(slots, target, day, today_day_number)
        if slot is not None:
            # before면 그 슬롯 '앞' = 바로 앞 슬롯이 앵커(첫 슬롯이면 None = 맨 앞).
            # after면 그 슬롯 자체가 앵커.
            anchor = _prev_slot(slots, slot) if before else slot
            return {
                "day": slot["day_number"],
                "after_slot_id": str(anchor["slot_id"]) if anchor else None,
                "source": "conversation",
            }
        # 매칭 실패 — 아래 day 분기로 흘려보낸다(docstring 참고). day도 없으면 None으로 끝난다.

    if day is not None:
        # source를 "conversation"과 구분하는 이유: 여기서 정한 "그 Day 맨 뒤"는 사용자가
        # 말한 자리가 아니라 서버가 고른 자리다. 앱은 자리가 하나로 확정된 경우
        # ("경복궁 가기 전에")만 확인 시트를 생략하고 바로 삽입하는데, 둘을 같은 값으로
        # 내려주면 "2일차에 카페 추천해줘"가 사용자가 지정하지 않은 위치로 조용히 삽입된다.
        # 덤으로 시트의 오문구도 고쳐진다 — 앱의 "말씀하신 대로 OO 다음에" 문구가
        # source=="conversation"에만 걸려 있어서, 여기까지 내려온 경우에도 사용자가 말한 적
        # 없는 장소를 "말씀하신 대로"라고 안내하고 있었다.
        last = _last_slot_of_day(slots, day)
        return {"day": day, "after_slot_id": str(last["slot_id"]) if last else None, "source": "conversation_day"}

    return None


async def _resolve_insertion(
    db: asyncpg.Pool, route: asyncpg.Record, estimated_slot: dict, hint: dict
) -> dict:
    """카드 탭 → 삽입 자리를 정한다. ①대화 힌트 → ②위치 추정 → ③오늘 Day 맨 뒤 순으로
    내려간다. 판단을 이 함수 하나에 가두는 이유는, 흩어지면 도구 설명(모델이 뭘 채울지)과
    응답(앱이 뭘 받을지)이 서로 다른 자리를 말하게 되기 때문이다.

    day/after_slot_id/source만 반환하고 장소명은 절대 담지 않는다 — 장소명을 서버가
    실어 보내면 그게 또 자유 문자열 통로가 된다(ProactiveContext에서 결함 4로 이미
    겪고 막은 문제와 같다). 이름은 앱이 슬롯 캐시에서 after_slot_id로 찾아 붙인다."""
    slots = await _load_route_slots(db, route["id"])

    today_day_number = (datetime.now(_KST).date() - route["start_date"]).days + 1

    conversation = _resolve_from_conversation(slots, hint, today_day_number, route["nights"])
    if conversation is not None:
        return conversation

    # ② 기존 _estimate_current_slot 결과를 그대로 재사용 — 낮 시간대 원탭 경험이
    # 이번 변경으로 회귀하면 안 되므로 판단 로직을 새로 만들지 않는다.
    if estimated_slot.get("confidence") == "high":
        return {
            "day": estimated_slot["day"],
            "after_slot_id": estimated_slot["slot_id"],
            "source": "estimated",
        }

    # ③ 오늘 Day 맨 뒤, 여행 범위 밖이면(밤·여행 전) 1일차 맨 뒤 — 대화도 추정도
    # 없을 때의 기본값. 슬롯이 없는 Day면 after_slot_id=None(빈 Day에도 삽입 가능해야 함).
    default_day = today_day_number if 1 <= today_day_number <= route["nights"] + 1 else 1
    last = _last_slot_of_day(slots, default_day)
    return {"day": default_day, "after_slot_id": str(last["slot_id"]) if last else None, "source": "default"}


async def handle_chat(
    db: asyncpg.Pool,
    redis,
    user_id: str,
    route_id: str,
    user_message: str,
    current_location: tuple[float, float] | None = None,
    language: str | None = None,
    proactive: ProactiveContext | None = None,
) -> tuple[str, list[dict] | None, dict | None, dict]:
    """route_id가 user_id 소유가 아니면 RouteNotFoundError를 던진다.
    반환: (자연어 답변, search_nearby_places 결과 장소 목록(카드 렌더용, 없으면 None),
          확신 높은 위치 추정이 있을 때만 {slot_id, day, order_index}(참고용 원본 추정치,
          없으면 None), _resolve_insertion이 정한 {day, after_slot_id, source}(카드 탭→
          일정 삽입 기준점, 항상 값이 있다))"""
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
        # 숙소 예외를 명시하는 이유: 이 문장이 규칙 3("숙소 기준이면 origin=accommodation")을
        # 이겨서, 숙소를 이미 알고 있는데도 "지금 어디 계세요?"라고 되묻는 게 실측됐다.
        # 숙소 기준 질문은 애초에 현재 위치가 필요 없다 — 예외를 여기 같이 적어야 안 진다.
        location_hint = (
            "\n\n[현재 위치 추정] 알 수 없습니다. 위치가 필요한 질문이면 추측하지 말고 "
            "사용자에게 지금 어디 있는지 먼저 물어보세요. 단 '숙소 근처'처럼 숙소를 기준으로 "
            "묻는 경우는 예외입니다 — 현재 위치가 필요 없으므로 되묻지 말고 "
            "search_nearby_places를 origin=\"accommodation\"으로 호출하세요."
        )

    # 오늘이 며칠차인지 프롬프트에 직접 넣는다. 이게 없으면 모델은 여행 기간만 보고
    # today_day(위치 추정 성공 시에만 채워짐)가 null일 때 "아직 여행 중이 아니시네요"라고
    # 단정한다 — 마지막 일정이 끝난 밤 시간대에 항상 그렇게 되는데, 숙소 기준 질문이
    # 가장 많이 나올 시간대가 정확히 거기다(실측). 프로액티브는 now를 알고 판단하는데
    # 챗봇만 오늘이 언제인지 몰랐던 것도 같은 불일치다.
    today_kst = datetime.now(_KST).date()
    day_number = (today_kst - route["start_date"]).days + 1
    today_label = (
        f"{today_kst.isoformat()} — 여행 {day_number}일차 (여행 중)"
        if 1 <= day_number <= route["nights"] + 1
        else f"{today_kst.isoformat()} — 여행 기간이 아님"
    )

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        destination=route["destination"],
        start_date=route["start_date"].isoformat(),
        end_date=route["end_date"].isoformat(),
        nights=route["nights"],
        nights_plus_1=route["nights"] + 1,
        today_label=today_label,
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
    insert_hint: dict = {}
    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = await _execute_tool(block.name, block.input, db, route, current_location, estimated_slot)
                if block.name == "search_nearby_places":
                    if result.get("places"):
                        last_places = result["places"]
                    # _tool_search_nearby_places의 반환은 더럽히지 않고 block.input에서
                    # 직접 읽는다. 도구가 이번 턴에 여러 번 불려도 마지막 호출의 힌트만
                    # 쓴다 — 사용자가 "아 됐고 시청 다음에"처럼 대화 중 마음을 바꾸면 가장
                    # 최근 의도가 이겨야 한다. insert_*는 자유 문자열이지만 시스템
                    # 프롬프트에는 닿지 않는다 — _resolve_insertion이 DB 슬롯 이름과
                    # 대조해 slot_id로 바꾸고, 매칭 실패하면 그냥 버린다(결함 4와는
                    # 다른 통로).
                    insert_hint = {
                        "insert_day": block.input.get("insert_day"),
                        "insert_before_place": block.input.get("insert_before_place"),
                        "insert_after_place": block.input.get("insert_after_place"),
                    }
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
    insertion = await _resolve_insertion(db, route, estimated_slot, insert_hint)
    # 모델이 넘긴 힌트와 그 해석 결과를 같이 남긴다. 자리가 엉뚱하다는 제보가 오면
    # 원인이 규칙(해석)인지 모델(힌트)인지 로그만으로 갈라내야 하는데, 힌트가 없으면
    # 둘을 구분할 방법이 없다 — 실제로 개발 중 이 구분이 안 돼 한참 헤맸다.
    logger.info("삽입 자리 결정: hint=%s → %s", insert_hint or {}, insertion)
    return reply, last_places, insertion_anchor, insertion

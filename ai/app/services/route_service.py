import json
import logging
from datetime import date, datetime, time, timedelta
from typing import AsyncGenerator

import asyncpg
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from app.config.city_centers import CITY_CENTERS
from app.config.settings import settings
from app.models.schemas import AccommodationAnchor, RouteGenRequest
from app.services.geo_clustering import cluster_candidates, cluster_label
from app.services.place_validator import validate_day_summary, validate_route_slot
from app.services.retrievers import PostgisTagRetriever, PgvectorRetriever
from app.services.transport_service import enrich_transport
from app.services.tsp_service import reorder_slots
from app.services.weather_service import FORECAST_WINDOW_DAYS, build_weather_forecast_text

logger = logging.getLogger(__name__)

# Anthropic SDK 클라이언트 — Sonnet 스트리밍 (Prompt Caching 안정적 적용)
_anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)

# OpenAI 클라이언트 — PgvectorRetriever 쿼리 임베딩용
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

ROUTE_GEN_SYSTEM_PROMPT = """당신은 한국 여행 전문 플래너입니다. 후보 장소 목록을 바탕으로 Day별 최적 여행 루트를 생성합니다.

출력 형식: 한 줄에 하나의 JSON 객체만 출력합니다 (ndjson).
{"type": "slot", "day": 1, "order": 1, "place_id": "uuid", "place_name": "장소명", "tip": "현지 팁 1~2문장", "duration_minutes": 90, "budget_estimate": 15000}

각 Day의 슬롯을 모두 출력한 직후, 그 Day를 요약하는 한 줄을 추가로 출력합니다:
{"type": "day_summary", "day": 1, "summary": "그날 분위기를 담은 한 문장(20~40자, 장소명 나열 금지)"}

규칙:
- 슬롯 수는 density 기준: relaxed=하루 3슬롯(여유롭게) | normal=하루 4~5슬롯(식사 2+관광/체험 2+카페/기타 1) | packed=하루 6슬롯(알차게)
- 동선 효율 최우선 (같은 구역끼리 묶기)
- budget_level 기준 (슬롯당 budget_estimate): tight(초절약)=~4,000원 | budget(알뜰)=~6,000원 | mid(여유롭게)=~12,000원 | premium(풍족하게)=~20,000원 | luxury(특별하게)=30,000원 이상
- place_id는 반드시 후보 목록의 실제 id 값만 사용 (임의 생성 금지)
- 같은 place_id를 루트 전체에서(하루 안에서든 다른 날이든) 두 번 이상 배치하지 말 것
- tip은 실용적인 현지 정보 (영업시간, 주차, 대기시간 등)
- JSON 문자열 내 개행은 반드시 \\n으로 이스케이프 (리터럴 개행문자 금지)
- JSON 외 다른 텍스트 출력 금지 — 오직 JSON 줄만
- hidden_gem 비율 목표가 주어지면 후보 목록의 is_hidden_gem=true 장소 비율을 해당 목표에 맞출 것

[예산 균등 배분]
- 각 날의 budget_estimate 합계가 비슷하도록 분산할 것 (Day 1에 집중 금지)
- 모든 날의 슬롯 수를 균등하게 배분 (±1 이내)

[Day별 구역 강제 배치]
- 후보 목록의 각 항목 앞에 [구역 A], [구역 B]... 라벨이 붙어 있으면, Day N은 반드시
  N번째 알파벳 구역([구역 A]=Day 1, [구역 B]=Day 2, ...)의 후보 중에서만 선택할 것
- 서로 다른 구역의 장소를 같은 Day에 섞지 말 것
- 라벨이 없으면 기존처럼 이동 30분 이내로 가까운 장소끼리 묶어 배치할 것 (fallback)

[날씨 반영]
- user 메시지에 Day별 날씨 라벨이 주어지면, 슬롯 order를 균등 3분할해 시간대로 간주: 앞쪽 1/3=오전, 중간 1/3=오후, 뒤쪽 1/3=저녁
- 해당 시간대 슬롯은 후보 목록의 "태그: ..." 표기에 #실내가 포함된 장소만 배치, #액티비티/#자연/#이벤트 등 실외 태그 장소는 그 시간대에 배치 금지
- "종일 비"는 모든 슬롯 #실내 태그 장소만, "맑음"은 제약 없음"""

# 프론트 SupportedLanguage 코드 → 프롬프트에 넣을 자연어 이름 (챗봇과 동일 패턴, ff1864c 참고)
_LANGUAGE_NAMES: dict[str, str] = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "中文"}


def _language_rule(language: str | None) -> str:
    """ROUTE_GEN_SYSTEM_PROMPT 뒤에 붙일 언어 규칙 — .format()을 안 쓰고 concat만 쓰는 이유는
    프롬프트 본문에 JSON 예시 중괄호가 많아 .format() placeholder로 오인되기 때문."""
    name = _LANGUAGE_NAMES.get(language, "한국어")
    return (
        "\n\n[언어]\n"
        f"- tip과 day_summary의 summary 텍스트는 {name}로 작성하세요.\n"
        "- place_name은 후보 목록에 주어진 원본 이름을 그대로 사용하세요(번역·음차 금지)."
    )


BUDGET_GUIDE: dict[str, str] = {
    "tight":   "하루 활동비 목표 2만원 (슬롯당 4,000원 이하)",
    "budget":  "하루 활동비 목표 3만원 (슬롯당 6,000원)",
    "mid":     "하루 활동비 목표 6만원 (슬롯당 12,000원)",
    "premium": "하루 활동비 목표 10만원 (슬롯당 20,000원)",
    "luxury":  "하루 활동비 목표 15만원 이상 (슬롯당 30,000원+)",
}

DENSITY_GUIDE: dict[str, str] = {
    "relaxed": "하루 3슬롯 목표 — 여유롭게 둘러보기",
    "normal":  "하루 4~5슬롯 — 식사 2 + 관광/체험 2 + 카페/기타 1",
    "packed":  "하루 6슬롯까지 — 알차게 이동",
}

# 프롬프트가 안내하는 목표치(DENSITY_GUIDE)의 상단 + 1(프롬프트가 이미 "±1 이내"를
# 명시하므로 그 여유를 하드캡으로 그대로 반영) — 텍스트 지시만으로는 검증을 뚫고
# 한 day에 슬롯이 계속 쌓이는 경우(실측: 10슬롯)를 코드로 차단한다.
DENSITY_SLOT_CAP: dict[str, int] = {
    "relaxed": 4,
    "normal": 6,
    "packed": 7,
}

# 하루 일정 시작 시각 — 사용자 개별 입력 없이 고정값 사용(추후 필요 시 입력 필드로 확장 가능)
DAY_START_TIME = time(9, 0)


def _assign_start_times(slots: list[dict]) -> list[dict]:
    """LLM이 시간을 직접 생성하지 않고, 이미 계산된 duration_minutes/transport_minutes를
    순서대로 누적해 start_time을 역산한다 — 도구가 생성한 시간과 실제 소요시간이
    어긋나는 걸 원천 차단(계산 결과가 곧 정답이므로 검증이 따로 필요 없음)."""
    current = datetime.combine(date.today(), DAY_START_TIME)
    for slot in slots:
        slot["start_time"] = current.time().strftime("%H:%M")
        duration = slot.get("duration_minutes") or 0
        transport = slot.get("transport_minutes") or 0
        current += timedelta(minutes=duration + transport)
    return slots


async def close_ai_clients() -> None:
    """lifespan 종료 시 호출 — httpx AsyncClient 정상 종료."""
    await _anthropic.close()
    await _openai.close()


def _cache_key(req: RouteGenRequest) -> str:
    themes = ":".join(sorted(req.themes))
    ratio = req.hidden_gem_ratio if req.hidden_gem_ratio is not None else 0.2
    # language가 캐시 키에 없으면 다른 언어로 생성된 tip/day_summary가 그대로 재사용됨
    language = req.language or "ko"
    return (
        f"route:{req.city}:{req.nights}:{req.group_type}:{req.budget_level}:"
        f"{themes}:{ratio:.1f}:{req.density}:{language}"
    )


def _is_weather_sensitive(start_date: date | None, today: date | None = None) -> bool:
    """출발일이 예보 유효 범위(FORECAST_WINDOW_DAYS) 이내면 날씨 민감 요청으로 간주해 캐시를 건너뛴다."""
    if start_date is None:
        return False
    return (start_date - (today or date.today())).days <= FORECAST_WINDOW_DAYS


def _build_accommodation_anchors(
    accommodations: list[AccommodationAnchor],
    start_date: date | None,
    day_count: int,
) -> dict[int, tuple[float, float]]:
    """day 번호 → 숙소 좌표 매핑. start_date 없으면(day↔날짜 매핑 불가) 빈 dict.
    day의 날짜가 [체크인, 체크아웃) 범위에 들면 그 숙소를 해당 day의 앵커로 쓴다
    (체크아웃 당일은 더 이상 그 숙소에 머무르지 않으므로 제외)."""
    if not accommodations or start_date is None:
        return {}
    anchors: dict[int, tuple[float, float]] = {}
    for day in range(1, day_count + 1):
        day_date = start_date + timedelta(days=day - 1)
        for acc in accommodations:
            if acc.check_in_date <= day_date < acc.check_out_date:
                if day in anchors:
                    logger.warning("day=%d: 숙소 여러 건과 겹침 — 먼저 매칭된 값 유지", day)
                    break
                anchors[day] = (acc.lat, acc.lng)
                break
    return anchors


async def stream_route(
    request: RouteGenRequest,
    db: asyncpg.Pool,
    redis=None,
) -> AsyncGenerator[str, None]:
    weather_sensitive = _is_weather_sensitive(request.start_date)
    # 숙소/이동수단이 있으면 결과(앵커, 이동시간)가 캐시 키에 안 잡히므로 캐시를 완전히
    # 우회한다 — 그렇지 않으면 반영 안 된 옛 캐시가 그대로 나갈 수 있다.
    has_accommodations = bool(request.accommodations)
    has_transport_mode = bool(request.transport_mode)

    # 캐시 히트 시 Redis에서 즉시 반환 (날씨 민감/숙소/이동수단 있는 요청은 매번 새로 생성)
    if redis is not None and not weather_sensitive and not has_accommodations and not has_transport_mode:
        try:
            cached = await redis.get(_cache_key(request))
            if cached:
                logger.info("캐시 히트: %s", _cache_key(request))
                for line in cached.split("\n"):
                    if line.strip():
                        yield line + "\n"
                return
        except Exception as e:
            logger.warning("Redis GET 오류 — 캐시 미스로 처리: %s", e)

    # 1. 임베딩 쿼리 텍스트 구성 — 도시 + 테마를 자연어로 조합
    query_text = f"{request.city} {' '.join(request.themes)}" if request.themes else request.city
    logger.info("pgvector 쿼리: %s", query_text)

    # 2. PgvectorRetriever로 유사도 기반 후보 장소 조회
    # OpenAI API 오류 시 PostgisTagRetriever로 폴백
    try:
        retriever = PgvectorRetriever(
            db=db,
            openai_client=_openai,
            city_coords=CITY_CENTERS[request.city],
        )
        candidates = await retriever.ainvoke(query_text)
    except Exception as e:
        logger.warning("PgvectorRetriever 오류 — PostgisTagRetriever 폴백: %s", e)
        candidates = await PostgisTagRetriever(
            db=db,
            city_coords=CITY_CENTERS[request.city],
            tags=request.themes,
        ).ainvoke("")
    logger.info("후보 장소 %d건", len(candidates))

    # 3. 날씨 예보 (start_date 없으면 오늘 기준) — Day별 텍스트로 프롬프트에 직접 삽입
    lon, lat = CITY_CENTERS[request.city]
    weather_forecast_text = await build_weather_forecast_text(
        destination=request.city,
        start_date=request.start_date or date.today(),
        nights=request.nights,
        api_key=settings.openweathermap_api_key,
        lon=lon,
        lat=lat,
    )

    # 4. 후보 장소 0건 조기 차단 — Sonnet 호출 및 환각 방지
    if not candidates:
        logger.warning("후보 장소 0건 — 루트 생성 불가: city=%s", request.city)
        yield '{"error": "후보 장소 없음", "city": "' + request.city + '"}\n'
        return

    # 환각 방지 2단계용 ID→이름 조회 테이블
    candidate_lookup = {doc.metadata["id"]: doc.metadata["name"] for doc in candidates}

    # TSP 동선 최적화용 ID→좌표 조회 테이블
    coord_lookup: dict[str, tuple[float, float]] = {
        doc.metadata["id"]: (float(doc.metadata["lat"]), float(doc.metadata["lng"]))
        for doc in candidates
    }

    # 5. 후보 장소 목록 텍스트 구성 — 지역 클러스터링으로 Day별 구역을 미리 나눔
    # 숙소가 있으면 Day 1 구역이 숙소 인근이 되도록 k-means 초기 centroid를 유도한다
    # (clustering이 cluster_candidates 호출 시점에 필요하므로 day_count/anchors를 여기서 먼저 계산).
    day_count = request.nights + 1
    accommodation_anchors = _build_accommodation_anchors(
        request.accommodations, request.start_date, day_count
    )
    clusters = cluster_candidates(
        candidates, k=day_count, day1_anchor=accommodation_anchors.get(1)
    )
    clustering_active = len(clusters) > 1

    # 환각(hallucination) 대체 시 전체 후보가 아니라 그 Day에 배정된 구역
    # 안에서만 교체되도록, Day → 구역 후보 lookup을 미리 만들어둔다.
    # clusters[i] = Day (i+1)의 구역이라는 대응은 프롬프트의 Day-구역 매핑과 동일하다.
    day_candidate_lookup: dict[int, dict[str, str]] = {}
    if clustering_active:
        for c_idx, cluster in enumerate(clusters):
            day_candidate_lookup[c_idx + 1] = {
                doc.metadata["id"]: doc.metadata["name"] for doc in cluster
            }

    if clustering_active:
        lines: list[str] = []
        idx = 1
        for c_idx, cluster in enumerate(clusters):
            label = cluster_label(c_idx)
            for doc in cluster:
                lines.append(f"[구역 {label}] [{idx}] id={doc.metadata['id']} | {doc.page_content}")
                idx += 1
        candidates_text = "\n".join(lines)
        mapping_desc = ", ".join(
            f"Day {i + 1} = 구역 {cluster_label(i)} ({len(c)}곳)"
            for i, c in enumerate(clusters)
        )
        day_region_line = f"Day-구역 매핑: {mapping_desc}\n"
    else:
        candidates_text = "\n".join(
            f"[{i + 1}] id={doc.metadata['id']} | {doc.page_content}"
            for i, doc in enumerate(candidates)
        )
        day_region_line = (
            f"총 {request.nights}박이므로 {request.nights + 1}개 지역 구역으로 나눠 Day별 집중 배치할 것\n"
        )

    ratio = request.hidden_gem_ratio if request.hidden_gem_ratio is not None else 0.2
    ratio_desc = "관광지 위주" if ratio < 0.3 else ("혼합" if ratio < 0.7 else "숨은 명소 위주")
    budget_hint = BUDGET_GUIDE.get(request.budget_level, "하루 활동비 목표 6만원 (슬롯당 12,000원)")
    density_hint = DENSITY_GUIDE.get(request.density, DENSITY_GUIDE["normal"])
    weather_hint = (
        f"Day별 날씨:\n{weather_forecast_text}\n\n"
        if weather_forecast_text else ""
    )
    user_message = (
        f"도시: {request.city} | {request.nights}박{request.nights + 1}일 | "
        f"여행 유형: {request.group_type} | 예산: {request.budget_level} — {budget_hint} | "
        f"밀도: {request.density} — {density_hint}\n"
        f"Hidden Gem 비율 목표: {ratio:.0%} ({ratio_desc})\n"
        f"{day_region_line}\n"
        f"{weather_hint}"
        f"후보 장소 ({len(candidates)}곳):\n{candidates_text}\n\n"
        f"{request.nights}박{request.nights + 1}일 루트를 생성하세요. "
        "각 슬롯을 JSON 한 줄씩 스트리밍 출력하세요."
    )

    # 6. Sonnet 스트리밍 (Prompt Caching으로 시스템 프롬프트 입력 비용 ~90% 절감)
    # day 경계마다 그 day를 TSP로 재정렬한 뒤 yield — 스트림/DB(Spring이 즉시 저장)/캐시가
    # 전부 동일한(=이미 최적화된) 순서를 보게 하기 위함. Day 1은 여전히 Day 2/3보다 먼저
    # 도착하므로 스트리밍의 체감 지연 이점은 유지된다.
    # 여행 일수(day 수)에 비례해 출력 토큰 확보 — 슬롯당 ~200토큰 + day_summary ~90토큰 기준.
    # 고정값(4096)이었을 때는 "type"/day_summary 추가로 늘어난 출력이 3일 이상 루트에서
    # max_tokens에 걸려 뒷부분 day가 통째로 유실되는 문제가 있었음.
    # 이전 공식(min(16000, 1500+day_count*1700))은 nights 유효범위(1~5)에서 최댓값이
    # 11700이라 16000 상한이 실제로 걸린 적이 없었음. 환각/중복 재시도가 많은 요청(실측:
    # 한 요청에서 53건)은 재시도 자체가 출력 토큰을 추가로 소모해 기존 공식으로도
    # 트렁케이션이 발생했음(실측: day_count=3에서 6600 토큰 소진) — 여유를 크게 늘림.
    # claude-sonnet-4-6 실제 출력 상한은 스트리밍 시 128,000토큰이라 아래 값은 전혀 근접하지 않고,
    # max_tokens는 상한일 뿐이라 정상 종료 시 실제 과금(출력 토큰 기준)엔 영향 없음.
    max_tokens = min(24000, 2500 + day_count * 3400)

    buffer = ""
    collected: list[str] = []
    day_buffer: list[str] = []
    current_day: int | None = None
    valid_days = set(range(1, request.nights + 2))
    used_place_ids: set[str] = set()  # 루트 전체에서 이미 배치된 장소 추적 — 중복 슬롯 방지
    day_slot_counts: dict[int, int] = {}  # day → 채택된 슬롯 수 (DENSITY_SLOT_CAP 판정용)
    slot_cap = DENSITY_SLOT_CAP.get(request.density, DENSITY_SLOT_CAP["normal"])

    async def _finalize_day(day_lines: list[str], day_number: int | None) -> list[str]:
        """TSP 재정렬 + 이동시간 enrichment + start_time 계산을 거친 최종 ndjson 라인을 반환한다."""
        reordered = reorder_slots(day_lines, coord_lookup, anchor=accommodation_anchors.get(day_number))
        slots = [json.loads(line) for line in reordered]
        enriched = await enrich_transport(slots, coord_lookup, request.transport_mode, settings.tmap_api_key)
        timed = _assign_start_times(enriched)
        return [json.dumps(s, ensure_ascii=False) + "\n" for s in timed]

    async def _ingest(validated: str) -> list[str]:
        """day 경계를 넘으면 이전 day를 TSP 재정렬+이동시간 enrichment해 반환, 아니면 버퍼링만 하고 빈 리스트 반환."""
        nonlocal current_day, day_buffer
        slot_day = json.loads(validated).get("day", 1)
        flushed: list[str] = []
        if current_day is not None and slot_day != current_day:
            flushed = await _finalize_day(day_buffer, current_day)
            day_buffer = []
        current_day = slot_day
        day_buffer.append(validated)
        day_slot_counts[slot_day] = day_slot_counts.get(slot_day, 0) + 1
        return flushed

    async def _process_line(line: str) -> list[str]:
        """한 줄을 타입별로 처리한다.
        day_summary는 place_id가 없어 TSP 좌표 조회가 실패하므로,
        day_buffer/_ingest()를 절대 거치지 않고 즉시 반환한다 — 섞이면 해당 day
        전체가 TSP 미적용으로 회귀한다."""
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            logger.warning("JSON 파싱 실패 — 스킵: %.80s", line)
            return []
        if obj.get("type") == "day_summary":
            validated = await validate_day_summary(line, valid_days)
            return [validated] if validated else []
        day = obj.get("day", 1)
        # density 목표(±1)를 코드로 강제 — 프롬프트 텍스트 지시만으로는 검증을 뚫고
        # 한 day에 슬롯이 계속 쌓이는 걸 못 막는다(실측: 환각/중복 재시도로 10슬롯까지 증가).
        # validate_route_slot보다 먼저 체크해야 캡 초과로 버릴 슬롯의 place_id가
        # used_place_ids에 낙인찍혀 낭비되는 걸 막을 수 있다.
        if day_slot_counts.get(day, 0) >= slot_cap:
            logger.warning(
                "day=%d 슬롯 상한(%d) 도달 — 스킵: place_id=%s place_name=%s",
                day, slot_cap, obj.get("place_id"), obj.get("place_name"),
            )
            return []
        # Day별 구역 강제 배치를 어기지 않도록, 환각/중복 치환도 그 Day에 배정된
        # 구역 후보로만 한정한다(day_candidate_lookup) — 사용 여부는 루트 전체에서 추적.
        lookup = day_candidate_lookup.get(day) or candidate_lookup
        validated = await validate_route_slot(line, lookup, used_place_ids)
        if validated is None:
            return []
        return await _ingest(validated)

    try:
        async with _anthropic.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": ROUTE_GEN_SYSTEM_PROMPT + _language_rule(request.language),
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            async for text in stream.text_stream:
                buffer += text
                # 완성된 JSON 줄만 검증
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if line:
                        for flushed_line in await _process_line(line):
                            collected.append(flushed_line)
                            yield flushed_line
            # 버퍼 잔여분 처리
            if buffer.strip():
                for flushed_line in await _process_line(buffer.strip()):
                    collected.append(flushed_line)
                    yield flushed_line

            final_message = await stream.get_final_message()

            # 프롬프트 캐싱 히트 여부 로깅 — cache_read_input_tokens가 계속 0이면
            # 캐시가 생성되지 않고 있다는 뜻(시스템 프롬프트가 모델 최소 캐시 토큰 미달 등)
            usage = final_message.usage
            logger.info(
                "Claude 캐시 사용량: cache_creation=%d cache_read=%d input=%d",
                usage.cache_creation_input_tokens or 0,
                usage.cache_read_input_tokens or 0,
                usage.input_tokens,
            )

            if final_message.stop_reason == "max_tokens":
                logger.error(
                    "Sonnet 응답이 max_tokens(%d)에서 잘림 — nights=%d, day_count=%d, "
                    "일부 day 데이터가 유실됐을 수 있음",
                    max_tokens, request.nights, day_count,
                )
        # 스트림 종료 — 마지막 day 플러시
        for flushed_line in await _finalize_day(day_buffer, current_day):
            collected.append(flushed_line)
            yield flushed_line
    except GeneratorExit:
        logger.info("클라이언트 연결 종료 — 스트리밍 정상 중단")
        return  # 부분 수집 데이터가 캐싱되지 않도록 명시적 종료
    except Exception as e:
        logger.error("Sonnet 스트리밍 오류: %s", e)
        raise

    # Redis 캐시 저장 (TTL 24h) — collected는 이미 day별로 TSP 재정렬된 상태이므로
    # 그대로 저장하면 스트림으로 전달된 내용과 100% 동일
    if redis is not None and collected and not weather_sensitive and not has_accommodations and not has_transport_mode:
        try:
            await redis.setex(_cache_key(request), 86400, "".join(collected))
            logger.info("캐시 저장: key=%s lines=%d", _cache_key(request), len(collected))
        except Exception as e:
            logger.warning("Redis SET 오류 — 저장 건너뜀: %s", e)

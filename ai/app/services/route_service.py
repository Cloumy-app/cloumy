import json
import logging
from datetime import date
from typing import AsyncGenerator

import asyncpg
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from app.config.city_centers import CITY_CENTERS
from app.config.settings import settings
from app.models.schemas import RouteGenRequest
from app.services.geo_clustering import cluster_candidates, cluster_label
from app.services.place_validator import validate_day_summary, validate_route_slot
from app.services.retrievers import PostgisTagRetriever, PgvectorRetriever
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


async def close_ai_clients() -> None:
    """lifespan 종료 시 호출 — httpx AsyncClient 정상 종료."""
    await _anthropic.close()
    await _openai.close()


def _cache_key(req: RouteGenRequest) -> str:
    themes = ":".join(sorted(req.themes))
    ratio = req.hidden_gem_ratio if req.hidden_gem_ratio is not None else 0.2
    return f"route:{req.city}:{req.nights}:{req.group_type}:{req.budget_level}:{themes}:{ratio:.1f}:{req.density}"


def _is_weather_sensitive(start_date: date | None, today: date | None = None) -> bool:
    """출발일이 예보 유효 범위(FORECAST_WINDOW_DAYS) 이내면 날씨 민감 요청으로 간주해 캐시를 건너뛴다."""
    if start_date is None:
        return False
    return (start_date - (today or date.today())).days <= FORECAST_WINDOW_DAYS


async def stream_route(
    request: RouteGenRequest,
    db: asyncpg.Pool,
    redis=None,
) -> AsyncGenerator[str, None]:
    weather_sensitive = _is_weather_sensitive(request.start_date)

    # 캐시 히트 시 Redis에서 즉시 반환 (날씨 민감 요청은 매번 최신 예보로 재생성)
    if redis is not None and not weather_sensitive:
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
    clusters = cluster_candidates(candidates, k=request.nights + 1)
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
    buffer = ""
    collected: list[str] = []
    day_buffer: list[str] = []
    current_day: int | None = None
    valid_days = set(range(1, request.nights + 2))
    day_used_ids: dict[int, set[str]] = {}

    def _ingest(validated: str) -> list[str]:
        """day 경계를 넘으면 이전 day를 TSP 재정렬해 반환, 아니면 버퍼링만 하고 빈 리스트 반환."""
        nonlocal current_day, day_buffer
        slot_day = json.loads(validated).get("day", 1)
        flushed: list[str] = []
        if current_day is not None and slot_day != current_day:
            flushed = reorder_slots(day_buffer, coord_lookup)
            day_buffer = []
        current_day = slot_day
        day_buffer.append(validated)
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
        lookup = day_candidate_lookup.get(day) or candidate_lookup
        used = day_used_ids.setdefault(day, set())
        validated = await validate_route_slot(line, lookup, used)
        if validated is None:
            return []
        used.add(json.loads(validated)["place_id"])
        return _ingest(validated)

    try:
        async with _anthropic.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=[
                {
                    "type": "text",
                    "text": ROUTE_GEN_SYSTEM_PROMPT,
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

            # 프롬프트 캐싱 히트 여부 로깅 — cache_read_input_tokens가 계속 0이면
            # 캐시가 생성되지 않고 있다는 뜻(시스템 프롬프트가 모델 최소 캐시 토큰 미달 등)
            usage = (await stream.get_final_message()).usage
            logger.info(
                "Claude 캐시 사용량: cache_creation=%d cache_read=%d input=%d",
                usage.cache_creation_input_tokens or 0,
                usage.cache_read_input_tokens or 0,
                usage.input_tokens,
            )
        # 스트림 종료 — 마지막 day 플러시
        for flushed_line in reorder_slots(day_buffer, coord_lookup):
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
    if redis is not None and collected and not weather_sensitive:
        try:
            await redis.setex(_cache_key(request), 86400, "".join(collected))
            logger.info("캐시 저장: key=%s lines=%d", _cache_key(request), len(collected))
        except Exception as e:
            logger.warning("Redis SET 오류 — 저장 건너뜀: %s", e)

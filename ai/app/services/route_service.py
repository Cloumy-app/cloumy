import logging
from typing import AsyncGenerator

import asyncpg
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from app.config.settings import settings
from app.models.schemas import RouteGenRequest
from app.services.place_validator import validate_route_slot
from app.services.retrievers import PostgisTagRetriever, PgvectorRetriever
from app.services.tsp_service import reorder_slots

logger = logging.getLogger(__name__)

CITY_CENTERS: dict[str, tuple[float, float]] = {
    "서울": (126.9780, 37.5665),
    "부산": (129.0756, 35.1796),
    "제주": (126.5312, 33.4996),
    "경주": (129.2114, 35.8562),
    "강릉": (128.8761, 37.7519),
    "전주": (127.1490, 35.8242),
    "여수": (127.6622, 34.7604),
    "인천": (126.7052, 37.4563),
    "대전": (127.3845, 36.3504),
    "대구": (128.6014, 35.8714),
    "광주": (126.8526, 35.1595),
    "속초": (128.5918, 38.2070),
    "춘천": (127.7298, 37.8813),
    "거제": (128.6211, 34.8800),
}

# Anthropic SDK 클라이언트 — Sonnet 스트리밍 (Prompt Caching 안정적 적용)
_anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)

# OpenAI 클라이언트 — PgvectorRetriever 쿼리 임베딩용
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

ROUTE_GEN_SYSTEM_PROMPT = """당신은 한국 여행 전문 플래너입니다. 후보 장소 목록을 바탕으로 Day별 최적 여행 루트를 생성합니다.

출력 형식: 한 줄에 하나의 JSON 객체만 출력합니다 (ndjson).
{"day": 1, "order": 1, "place_id": "uuid", "place_name": "장소명", "tip": "현지 팁 1~2문장", "duration_minutes": 90, "budget_estimate": 15000}

규칙:
- 하루 최대 5슬롯: 식사 2 + 관광/체험 2 + 카페/기타 1
- 동선 효율 최우선 (같은 구역끼리 묶기)
- budget_level 기준 (슬롯당 budget_estimate): tight(초절약)=~4,000원 | budget(알뜰)=~6,000원 | mid(여유롭게)=~12,000원 | premium(풍족하게)=~20,000원 | luxury(특별하게)=30,000원 이상
- place_id는 반드시 후보 목록의 실제 id 값만 사용 (임의 생성 금지)
- tip은 실용적인 현지 정보 (영업시간, 주차, 대기시간 등)
- JSON 문자열 내 개행은 반드시 \\n으로 이스케이프 (리터럴 개행문자 금지)
- JSON 외 다른 텍스트 출력 금지 — 오직 JSON 줄만
- hidden_gem 비율 목표가 주어지면 후보 목록의 is_hidden_gem=true 장소 비율을 해당 목표에 맞출 것"""

BUDGET_GUIDE: dict[str, str] = {
    "tight":   "하루 활동비 목표 2만원 (슬롯당 4,000원 이하)",
    "budget":  "하루 활동비 목표 3만원 (슬롯당 6,000원)",
    "mid":     "하루 활동비 목표 6만원 (슬롯당 12,000원)",
    "premium": "하루 활동비 목표 10만원 (슬롯당 20,000원)",
    "luxury":  "하루 활동비 목표 15만원 이상 (슬롯당 30,000원+)",
}


async def close_ai_clients() -> None:
    """lifespan 종료 시 호출 — httpx AsyncClient 정상 종료."""
    await _anthropic.close()
    await _openai.close()


def _cache_key(req: RouteGenRequest) -> str:
    themes = ":".join(sorted(req.themes))
    ratio = req.hidden_gem_ratio if req.hidden_gem_ratio is not None else 0.2
    return f"route:{req.city}:{req.nights}:{req.group_type}:{req.budget_level}:{themes}:{ratio:.1f}"


async def stream_route(
    request: RouteGenRequest,
    db: asyncpg.Pool,
    redis=None,
) -> AsyncGenerator[str, None]:
    # 캐시 히트 시 Redis에서 즉시 반환
    if redis is not None:
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
            tags=[],
        ).ainvoke("")
    logger.info("후보 장소 %d건", len(candidates))

    # 3. 후보 장소 0건 조기 차단 — Sonnet 호출 및 환각 방지
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

    # 4. 후보 장소 목록 텍스트 구성
    candidates_text = "\n".join(
        f"[{i + 1}] id={doc.metadata['id']} | {doc.page_content}"
        for i, doc in enumerate(candidates)
    )
    ratio = request.hidden_gem_ratio if request.hidden_gem_ratio is not None else 0.2
    ratio_desc = "관광지 위주" if ratio < 0.3 else ("혼합" if ratio < 0.7 else "숨은 명소 위주")
    budget_hint = BUDGET_GUIDE.get(request.budget_level, "하루 활동비 목표 6만원 (슬롯당 12,000원)")
    user_message = (
        f"도시: {request.city} | {request.nights}박{request.nights + 1}일 | "
        f"여행 유형: {request.group_type} | 예산: {request.budget_level} — {budget_hint}\n"
        f"Hidden Gem 비율 목표: {ratio:.0%} ({ratio_desc})\n\n"
        f"후보 장소 ({len(candidates)}곳):\n{candidates_text}\n\n"
        f"{request.nights}박{request.nights + 1}일 루트를 생성하세요. "
        "각 슬롯을 JSON 한 줄씩 스트리밍 출력하세요."
    )

    # 5. Sonnet 스트리밍 (Prompt Caching으로 시스템 프롬프트 입력 비용 ~90% 절감)
    buffer = ""
    collected: list[str] = []
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
                # 완성된 JSON 줄만 즉시 yield
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if line:
                        validated = await validate_route_slot(line, candidate_lookup)
                        if validated is not None:
                            collected.append(validated)
                            yield validated
            # 버퍼 잔여분 처리
            if buffer.strip():
                validated = await validate_route_slot(buffer.strip(), candidate_lookup)
                if validated is not None:
                    collected.append(validated)
                    yield validated
    except GeneratorExit:
        logger.info("클라이언트 연결 종료 — 스트리밍 정상 중단")
        return  # 부분 수집 데이터가 캐싱되지 않도록 명시적 종료
    except Exception as e:
        logger.error("Sonnet 스트리밍 오류: %s", e)
        raise

    # 스트리밍 완료 후 TSP 동선 최적화 (캐시에는 최적화된 순서 저장)
    if collected:
        collected = reorder_slots(collected, coord_lookup)

    # Redis 캐시 저장 (TTL 24h)
    if redis is not None and collected:
        try:
            await redis.setex(_cache_key(request), 86400, "".join(collected))
            logger.info("캐시 저장: key=%s lines=%d", _cache_key(request), len(collected))
        except Exception as e:
            logger.warning("Redis SET 오류 — 저장 건너뜀: %s", e)

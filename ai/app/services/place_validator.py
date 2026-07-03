import json
import logging

logger = logging.getLogger(__name__)


async def validate_route_slot(
    line: str,
    candidate_lookup: dict[str, str],  # {place_id: place_name}
) -> str | None:
    """ndjson 한 줄의 place_id를 검증한다. 환각 감지 시 유효 후보로 교체.
    JSON 파싱 실패 시 None 반환 — 호출 측에서 캐싱 및 yield 제외."""
    try:
        slot = json.loads(line)
    except json.JSONDecodeError:
        logger.warning("JSON 파싱 실패 — 슬롯 스킵: %.80s", line)
        return None

    place_id = slot.get("place_id")
    if not place_id or place_id in candidate_lookup:
        return json.dumps(slot, ensure_ascii=False) + "\n"

    # 환각 감지
    logger.warning("환각 감지: place_id=%s name=%s", place_id, slot.get("place_name"))

    # Phase A: 후보 중 첫 번째로 교체 (Phase B: pgvector 유사도 검색으로 교체 예정)
    if not candidate_lookup:
        return json.dumps(slot, ensure_ascii=False) + "\n"
    replacement_id, replacement_name = next(iter(candidate_lookup.items()))
    slot["place_id"] = replacement_id
    slot["place_name"] = replacement_name

    logger.info("환각 교체: %s → %s (%s)", place_id, replacement_id, replacement_name)
    return json.dumps(slot, ensure_ascii=False) + "\n"


async def validate_day_summary(line: str, valid_days: set[int]) -> str | None:
    """ndjson 한 줄의 day_summary를 검증한다.
    JSON 파싱 실패, 빈 summary, 범위를 벗어난 day(환각 day)는 None 반환."""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        logger.warning("day_summary JSON 파싱 실패 — 스킵: %.60s", line)
        return None

    summary = (obj.get("summary") or "").strip()
    day = obj.get("day")
    if not summary or day not in valid_days:
        logger.warning("day_summary 유효성 실패: day=%s summary_len=%d", day, len(summary))
        return None

    return json.dumps({"type": "day_summary", "day": day, "summary": summary}, ensure_ascii=False) + "\n"

import json
import logging

logger = logging.getLogger(__name__)


async def validate_route_slot(
    line: str,
    candidate_lookup: dict[str, str],  # {place_id: place_name}
    used_place_ids: set[str],
) -> str | None:
    """ndjson 한 줄의 place_id를 검증한다. 환각이거나 루트 내에서 이미 쓰인 장소(중복)면
    아직 안 쓴 후보로 교체한다. JSON 파싱 실패 시 None 반환 — 호출 측에서 캐싱 및 yield 제외."""
    try:
        slot = json.loads(line)
    except json.JSONDecodeError:
        logger.warning("JSON 파싱 실패 — 슬롯 스킵: %.80s", line)
        return None

    place_id = slot.get("place_id")
    if not place_id:
        return json.dumps(slot, ensure_ascii=False) + "\n"

    if place_id in candidate_lookup and place_id not in used_place_ids:
        used_place_ids.add(place_id)
        return json.dumps(slot, ensure_ascii=False) + "\n"

    if place_id not in candidate_lookup:
        logger.warning("환각 감지: place_id=%s name=%s", place_id, slot.get("place_name"))
    else:
        logger.warning("중복 감지: place_id=%s name=%s", place_id, slot.get("place_name"))

    if not candidate_lookup:
        return json.dumps(slot, ensure_ascii=False) + "\n"

    # 아직 안 쓴 후보로 교체 — 항상 같은 후보로 치환하면 그 자체가 중복을 유발하므로
    # used_place_ids에 없는 첫 후보를 찾는다.
    replacement = next((pid for pid in candidate_lookup if pid not in used_place_ids), None)
    if replacement is None:
        logger.warning("교체 가능한 미사용 후보 없음 — 슬롯 스킵")
        return None

    slot["place_id"] = replacement
    slot["place_name"] = candidate_lookup[replacement]
    used_place_ids.add(replacement)

    logger.info("환각/중복 교체: %s → %s (%s)", place_id, replacement, candidate_lookup[replacement])
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

import json
import pytest
from app.services.place_validator import validate_day_summary, validate_route_slot

CANDIDATES = {"uuid-a": "카페 A", "uuid-b": "식당 B"}

VALID_SLOT = json.dumps({
    "day": 1, "order": 1, "place_id": "uuid-a",
    "place_name": "카페 A", "tip": "팁", "duration_minutes": 60, "budget_estimate": 10000,
})


async def test_valid_slot_pass_through():
    result = await validate_route_slot(VALID_SLOT, CANDIDATES)
    assert result is not None
    assert '"uuid-a"' in result


async def test_hallucinated_place_id_replaced():
    line = json.dumps({
        "day": 1, "order": 1, "place_id": "fake-uuid",
        "place_name": "없는 곳", "tip": "", "duration_minutes": 60, "budget_estimate": 5000,
    })
    result = await validate_route_slot(line, CANDIDATES)
    assert result is not None
    assert "fake-uuid" not in result
    assert "uuid-a" in result  # 후보 첫 번째 항목으로 교체


async def test_invalid_json_returns_none():
    result = await validate_route_slot("not-json", CANDIDATES)
    assert result is None


async def test_empty_candidate_lookup_returns_slot():
    # 환각 place_id여도 후보 목록이 비어 있으면 pass-through
    line = json.dumps({
        "day": 1, "order": 1, "place_id": "any-id",
        "place_name": "장소", "tip": "", "duration_minutes": 60, "budget_estimate": 5000,
    })
    result = await validate_route_slot(line, {})
    assert result is not None


async def test_output_ends_with_newline():
    result = await validate_route_slot(VALID_SLOT, CANDIDATES)
    assert result is not None
    assert result.endswith("\n")


async def test_duplicate_valid_place_replaced():
    # 유효한 place_id지만 같은 Day에서 이미 사용된 장소면 다른 후보로 교체
    line = json.dumps({
        "day": 1, "order": 2, "place_id": "uuid-a",
        "place_name": "카페 A", "tip": "", "duration_minutes": 60, "budget_estimate": 10000,
    })
    result = await validate_route_slot(line, CANDIDATES, used_place_ids={"uuid-a"})
    assert result is not None
    assert '"uuid-a"' not in result
    assert "uuid-b" in result


async def test_hallucination_avoids_already_used_place():
    # 환각 place_id를 교체할 때, 같은 Day에서 이미 쓰인 후보는 피해야 함
    line = json.dumps({
        "day": 1, "order": 2, "place_id": "fake-uuid",
        "place_name": "없는 곳", "tip": "", "duration_minutes": 60, "budget_estimate": 5000,
    })
    result = await validate_route_slot(line, CANDIDATES, used_place_ids={"uuid-a"})
    assert result is not None
    assert "uuid-b" in result
    assert '"uuid-a"' not in result


async def test_missing_place_id_returns_slot():
    # place_id 필드 자체가 없으면 pass-through
    line = json.dumps({
        "day": 1, "order": 1,
        "place_name": "카페 A", "tip": "", "duration_minutes": 60, "budget_estimate": 10000,
    })
    result = await validate_route_slot(line, CANDIDATES)
    assert result is not None


VALID_DAYS = {1, 2, 3}


async def test_valid_day_summary_pass_through():
    line = json.dumps({"type": "day_summary", "day": 1, "summary": "해운대 해변과 감천문화마을을 둘러보는 하루"})
    result = await validate_day_summary(line, VALID_DAYS)
    assert result is not None
    obj = json.loads(result)
    assert obj == {"type": "day_summary", "day": 1, "summary": "해운대 해변과 감천문화마을을 둘러보는 하루"}


async def test_day_summary_empty_summary_rejected():
    line = json.dumps({"type": "day_summary", "day": 1, "summary": "   "})
    result = await validate_day_summary(line, VALID_DAYS)
    assert result is None


async def test_day_summary_missing_summary_rejected():
    line = json.dumps({"type": "day_summary", "day": 1})
    result = await validate_day_summary(line, VALID_DAYS)
    assert result is None


async def test_day_summary_out_of_range_day_rejected():
    # 환각 day (요청 범위를 벗어남) 거부
    line = json.dumps({"type": "day_summary", "day": 99, "summary": "정상 문장"})
    result = await validate_day_summary(line, VALID_DAYS)
    assert result is None


async def test_day_summary_invalid_json_rejected():
    result = await validate_day_summary("not-json", VALID_DAYS)
    assert result is None


async def test_day_summary_output_ends_with_newline():
    line = json.dumps({"type": "day_summary", "day": 2, "summary": "정상 문장"})
    result = await validate_day_summary(line, VALID_DAYS)
    assert result is not None
    assert result.endswith("\n")

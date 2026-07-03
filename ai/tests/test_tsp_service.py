import json
from itertools import permutations

import pytest
from app.services.tsp_service import _haversine_m, _tsp_order, reorder_slots


def _make_slot(day: int, order: int, place_id: str, place_name: str = "X") -> str:
    return json.dumps({
        "day": day, "order": order, "place_id": place_id,
        "place_name": place_name, "tip": "", "duration_minutes": 60, "budget_estimate": 0,
    }) + "\n"


def test_haversine_seoul_to_nearby():
    # 경복궁 → 광화문 (실측 약 410m)
    d = _haversine_m(37.5796, 126.9770, 37.5759, 126.9769)
    assert 300 < d < 600


def test_haversine_same_point():
    assert _haversine_m(37.0, 127.0, 37.0, 127.0) == 0


def _path_distance(coords: list[tuple[float, float]], order: list[int]) -> int:
    return sum(
        _haversine_m(*coords[order[i]], *coords[order[i + 1]])
        for i in range(len(order) - 1)
    )


def test_tsp_order_minimizes_open_path_not_round_trip():
    # 시작점(0번)을 고정하고 나머지 순열을 전수조사해 "진짜 최단 편도 거리"를 구한 뒤,
    # _tsp_order()가 이 편도 거리를 최소화하는지 검증한다.
    # (폐루프로 최적화하면 "마지막 지점 -> 시작점 복귀" 비용까지 고려하게 되어
    # 편도 기준 최적해와 다른 순서를 반환할 수 있다.)
    coords = [
        (37.6724338655586, 126.95140605674521),
        (37.48455135331991, 127.02674126124717),
        (37.5855106990026, 126.87515190240873),
        (37.67292387679047, 127.09483564281129),
        (37.64306517079898, 127.07064978513188),
    ]
    order = _tsp_order(coords)
    assert sorted(order) == list(range(len(coords)))  # 모든 지점을 정확히 한 번씩 방문

    got_distance = _path_distance(coords, order)
    best_distance = min(
        _path_distance(coords, [0, *perm])
        for perm in permutations(range(1, len(coords)))
    )
    assert got_distance == best_distance


def test_reorder_slots_one_slot_unchanged():
    slots = [_make_slot(1, 1, "a")]
    coord_lookup = {"a": (37.5, 126.9)}
    result = reorder_slots(slots, coord_lookup)
    assert len(result) == 1
    assert json.loads(result[0])["order"] == 1


def test_reorder_slots_order_reset_from_one():
    # 원래 order가 뒤섞여 있어도 1부터 재할당돼야 함
    slots = [
        _make_slot(1, 3, "a", "A"),
        _make_slot(1, 1, "b", "B"),
        _make_slot(1, 2, "c", "C"),
    ]
    coord_lookup = {
        "a": (37.5, 126.9),
        "b": (37.6, 127.0),
        "c": (37.55, 126.95),
    }
    result = reorder_slots(slots, coord_lookup)
    orders = [json.loads(r)["order"] for r in result]
    assert sorted(orders) == [1, 2, 3]


def test_reorder_slots_multi_day_independent():
    # day 1과 day 2는 독립적으로 최적화, 두 day 모두 결과에 포함돼야 함
    slots = [
        _make_slot(1, 1, "a"),
        _make_slot(2, 1, "b"),
    ]
    coord_lookup = {
        "a": (37.5, 126.9),
        "b": (35.1, 129.0),
    }
    result = reorder_slots(slots, coord_lookup)
    days = [json.loads(r)["day"] for r in result]
    assert 1 in days and 2 in days


def test_reorder_slots_missing_coord_appended_at_end():
    # 좌표 없는 슬롯은 최적화 대상에서 빠지고 순서 맨 뒤에 붙는다
    slots = [
        _make_slot(1, 1, "a"),
        _make_slot(1, 2, "missing"),
    ]
    coord_lookup = {"a": (37.5, 126.9)}  # "missing"은 좌표 없음
    result = reorder_slots(slots, coord_lookup)
    assert len(result) == 2
    assert json.loads(result[-1])["place_id"] == "missing"
    assert json.loads(result[-1])["order"] == 2


def test_reorder_slots_missing_coord_mixed_with_multiple_optimized():
    # 좌표 있는 슬롯 3건은 TSP로 재정렬되고, 좌표 없는 슬롯 1건은 맨 뒤에 붙는다
    slots = [
        _make_slot(1, 1, "a", "A"),
        _make_slot(1, 2, "b", "B"),
        _make_slot(1, 3, "missing", "M"),
        _make_slot(1, 4, "c", "C"),
    ]
    coord_lookup = {
        "a": (37.5, 126.9),
        "b": (37.6, 127.0),
        "c": (37.55, 126.95),
    }
    result = reorder_slots(slots, coord_lookup)
    assert len(result) == 4
    orders = [json.loads(r)["order"] for r in result]
    assert sorted(orders) == [1, 2, 3, 4]
    assert json.loads(result[-1])["place_id"] == "missing"
    assert json.loads(result[-1])["order"] == 4
    optimized_ids = {json.loads(r)["place_id"] for r in result[:3]}
    assert optimized_ids == {"a", "b", "c"}


def test_reorder_invalid_json_skipped():
    # JSON 파싱 실패 슬롯은 건너뛰고, 유효한 슬롯만 반환
    slots = ["not-json\n", _make_slot(1, 1, "a")]
    coord_lookup = {"a": (37.5, 126.9)}
    result = reorder_slots(slots, coord_lookup)
    assert len(result) == 1

import math

import pytest
from unittest.mock import AsyncMock, patch

from app.services.transport_service import (
    _build_transit_detail,
    _build_transit_summary,
    _estimate_minutes,
    enrich_transport,
)

# 강남역 -> 서울역 직선거리 약 8.4km (1km 초과 → transit 자동 판정)
_GANGNAM = (37.4979, 127.0276)
_SEOUL_STATION = (37.5547, 126.9707)

_R_METERS = 6_371_000


def _point_north_of(origin: tuple[float, float], meters: float) -> tuple[float, float]:
    """origin에서 정북 방향으로 meters만큼 떨어진 좌표. _haversine_m과 동일한 구면 모델이라
    순수 위도 이동에서는 haversine 결과가 R * 라디안값과 정확히 일치해 경계값 테스트에 안전하다."""
    lat, lng = origin
    delta_deg = math.degrees(meters / _R_METERS)
    return (lat + delta_deg, lng)


_ORIGIN = (37.5000, 127.0000)


def test_estimate_minutes_walk_reasonable():
    minutes = _estimate_minutes(8.4, "walk")
    assert 150 < minutes < 170  # 8.4km * 1.3 / 4km/h * 60 ≈ 164분


def test_estimate_minutes_car_reasonable():
    minutes = _estimate_minutes(8.4, "car")
    assert 20 < minutes < 30  # 8.4km * 1.3 / 25km/h * 60 ≈ 26분


def test_estimate_minutes_never_zero():
    assert _estimate_minutes(0.01, "car") >= 1


async def test_enrich_transport_close_distance_is_walk_no_network():
    """1km 이내는 Tmap 호출 없이 거리 근사치로 walk 판정."""
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 300)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "walk"
    assert result[0]["transport_minutes"] > 0
    assert "transport_to_next" not in result[1]  # 마지막 슬롯은 다음 구간이 없음


async def test_enrich_transport_boundary_under_1km_is_walk():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 999)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "walk"


async def test_enrich_transport_boundary_exactly_1km_is_walk():
    """정확히 1000m는 경계 포함(이하=walk) 규칙에 따라 walk로 판정되어야 한다.
    _haversine_m이 int()로 내림하므로 nominal 1000m는 정확히 1000으로 떨어진다
    (아래 python으로 사전 검증: raw=1000.0000, floored=1000)."""
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 1000)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "walk"


async def test_enrich_transport_boundary_over_1km_is_transit():
    """nominal 1001m는 _haversine_m의 int() 내림 때문에 정확히 1000으로 떨어져
    경계 포함 규칙상 walk가 되어버린다(사전 검증 완료) — 1002m을 사용해
    내림 후에도 1000을 확실히 초과하도록 한다."""
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 1002)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "transit"


async def test_enrich_transport_transit_without_key_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "transit"
    assert result[0]["transport_minutes"] > 0  # 근사치로 채워짐
    assert result[0]["transit_summary"] is None  # 키 없으면 노선 요약도 없음
    assert result[0]["transit_detail"] is None


async def test_enrich_transport_transit_api_error_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(side_effect=Exception("Tmap API 장애")),
    ):
        result = await enrich_transport(slots, coord_lookup, "dummy-key")
    assert result[0]["transport_minutes"] > 0  # 예외 발생해도 근사치로 폴백, 크래시 없음
    assert result[0]["transit_summary"] is None
    assert result[0]["transit_detail"] is None


async def test_enrich_transport_missing_coord_skips_pair():
    slots = [{"place_id": "a"}, {"place_id": "unknown"}]
    coord_lookup = {"a": _GANGNAM}
    result = await enrich_transport(slots, coord_lookup, "")
    assert "transport_to_next" not in result[0]  # 좌표 없는 상대와는 계산 스킵


def test_build_transit_summary_bus_to_subway_one_transfer():
    itinerary = {"legs": [
        {"mode": "BUS", "route": "143"},
        {"mode": "SUBWAY", "route": "2호선"},
    ]}
    assert _build_transit_summary(itinerary) == "버스 143 → 지하철 2호선 (환승 1회)"


def test_build_transit_summary_all_walk_returns_none():
    itinerary = {"legs": [{"mode": "WALK"}]}
    assert _build_transit_summary(itinerary) is None


def test_build_transit_summary_missing_route_field_no_keyerror():
    itinerary = {"legs": [{"mode": "BUS"}]}  # route 키 자체가 없음
    assert _build_transit_summary(itinerary) == "버스"


def test_build_transit_summary_unknown_mode_skipped():
    itinerary = {"legs": [
        {"mode": "FERRY", "route": "여객선"},
        {"mode": "BUS", "route": "143"},
    ]}
    assert _build_transit_summary(itinerary) == "버스 143"


def test_build_transit_detail_bus_to_subway_one_transfer():
    itinerary = {"legs": [
        {"mode": "WALK", "sectionTime": 143},
        {"mode": "BUS", "route": "143", "sectionTime": 629,
         "start": {"name": "강남역9번출구"}, "end": {"name": "교대역"}},
        {"mode": "SUBWAY", "route": "2호선", "sectionTime": 900,
         "start": {"name": "교대역"}, "end": {"name": "서울역"}},
    ]}
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "143", "board_stop": "강남역9번출구", "alight_stop": "교대역", "minutes": 10},
        {"mode": "지하철", "route": "2호선", "board_stop": "교대역", "alight_stop": "서울역", "minutes": 15},
    ]


def test_build_transit_detail_all_walk_returns_none():
    itinerary = {"legs": [{"mode": "WALK", "sectionTime": 300}]}
    assert _build_transit_detail(itinerary) is None


def test_build_transit_detail_missing_optional_fields_no_keyerror():
    itinerary = {"legs": [{"mode": "BUS"}]}  # route/start/end/sectionTime 전부 없음
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "", "board_stop": "", "alight_stop": "", "minutes": 0}
    ]


def test_build_transit_detail_unknown_mode_skipped():
    itinerary = {"legs": [
        {"mode": "FERRY", "route": "여객선", "start": {"name": "A"}, "end": {"name": "B"}, "sectionTime": 600},
        {"mode": "BUS", "route": "143", "start": {"name": "C"}, "end": {"name": "D"}, "sectionTime": 300},
    ]}
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "143", "board_stop": "C", "alight_stop": "D", "minutes": 5}
    ]

import pytest
from unittest.mock import AsyncMock, patch

from app.services.transport_service import _build_transit_summary, _estimate_minutes, enrich_transport

# 강남역 -> 서울역 직선거리 약 8.4km
_GANGNAM = (37.4979, 127.0276)
_SEOUL_STATION = (37.5547, 126.9707)


def test_estimate_minutes_walk_reasonable():
    minutes = _estimate_minutes(8.4, "walk")
    assert 150 < minutes < 170  # 8.4km * 1.3 / 4km/h * 60 ≈ 164분


def test_estimate_minutes_car_reasonable():
    minutes = _estimate_minutes(8.4, "car")
    assert 20 < minutes < 30  # 8.4km * 1.3 / 25km/h * 60 ≈ 26분


def test_estimate_minutes_never_zero():
    assert _estimate_minutes(0.01, "car") >= 1


async def test_enrich_transport_no_mode_returns_unchanged():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    result = await enrich_transport(slots, {}, None, "")
    assert result == slots
    assert "transport_to_next" not in result[0]


async def test_enrich_transport_walk_uses_approximation_no_network():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    result = await enrich_transport(slots, coord_lookup, "walk", "")
    assert result[0]["transport_to_next"] == "walk"
    assert result[0]["transport_minutes"] > 0
    assert "transport_to_next" not in result[1]  # 마지막 슬롯은 다음 구간이 없음


async def test_enrich_transport_car_maps_to_taxi_label():
    # DB CHECK 제약(route_slots.transport_to_next)이 'car'가 아니라 'taxi'를 요구함
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    result = await enrich_transport(slots, coord_lookup, "car", "")
    assert result[0]["transport_to_next"] == "taxi"


async def test_enrich_transport_transit_without_key_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    result = await enrich_transport(slots, coord_lookup, "transit", "")
    assert result[0]["transport_to_next"] == "transit"
    assert result[0]["transport_minutes"] > 0  # 근사치로 채워짐
    assert result[0]["transit_summary"] is None  # 키 없으면 노선 요약도 없음


async def test_enrich_transport_transit_api_error_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(side_effect=Exception("Tmap API 장애")),
    ):
        result = await enrich_transport(slots, coord_lookup, "transit", "dummy-key")
    assert result[0]["transport_minutes"] > 0  # 예외 발생해도 근사치로 폴백, 크래시 없음
    assert result[0]["transit_summary"] is None


async def test_enrich_transport_missing_coord_skips_pair():
    slots = [{"place_id": "a"}, {"place_id": "unknown"}]
    coord_lookup = {"a": _GANGNAM}
    result = await enrich_transport(slots, coord_lookup, "walk", "")
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

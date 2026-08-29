import math
from datetime import date, datetime, time, timedelta

import pytest
from unittest.mock import AsyncMock, patch

from app.services.transport_service import (
    _KST,
    _build_transit_detail,
    _build_transit_summary,
    _estimate_minutes,
    _tmap_transit_route,
    enrich_transport,
    find_last_departure,
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


# ── _tmap_transit_route: search_dttm / fare ──────────────────────────────


class _FakeResponse:
    """httpx.Response 흉내 — raise_for_status()는 아무 일도 안 하고 json()만 그대로 돌려준다."""

    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeClient:
    """httpx.AsyncClient 흉내. post() 호출 시 넘어온 kwargs(특히 json 바디)를 기록해둔다."""

    def __init__(self, payload: dict):
        self._payload = payload
        self.last_kwargs: dict | None = None

    async def post(self, url, **kwargs):
        self.last_kwargs = kwargs
        return _FakeResponse(self._payload)


def _itinerary_payload(fare: int | None) -> dict:
    itinerary = {"totalTime": 2040, "legs": [{"mode": "BUS", "route": "143"}]}
    if fare is not None:
        itinerary["fare"] = {"regular": {"totalFare": fare}}
    return {"metaData": {"plan": {"itineraries": [itinerary]}}}


async def test_tmap_transit_route_without_search_dttm_omits_key():
    """search_dttm을 안 넘기면 기존 동작대로 요청 바디에 searchDttm이 없어야 한다(회귀 방지)."""
    client = _FakeClient(_itinerary_payload(fare=None))
    result = await _tmap_transit_route(client, *_GANGNAM, *_SEOUL_STATION, "dummy-key")
    assert "searchDttm" not in client.last_kwargs["json"]
    assert result["minutes"] == 34
    assert result["fare"] is None  # fare가 응답에 없으면 안전하게 None


async def test_tmap_transit_route_with_search_dttm_includes_key():
    """search_dttm을 넘기면 요청 바디에 그대로 실려야 한다."""
    client = _FakeClient(_itinerary_payload(fare=1450))
    result = await _tmap_transit_route(
        client, *_GANGNAM, *_SEOUL_STATION, "dummy-key", search_dttm="202608272200"
    )
    assert client.last_kwargs["json"]["searchDttm"] == "202608272200"
    assert result["fare"] == 1450


async def test_enrich_transport_uses_tmap_result_dict():
    """_tmap_transit_route가 dict를 반환하도록 바뀌었으니 enrich_transport의 언팩이
    올바른 키로 이루어지는지 확인한다(회귀 방지). fare는 route_slots에 저장하지 않는다."""
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    fake_result = {
        "minutes": 34, "fare": 1450,
        "summary": "버스 143 → 지하철 2호선 (환승 1회)",
        "detail": [{"mode": "버스"}],
    }
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(return_value=fake_result),
    ):
        result = await enrich_transport(slots, coord_lookup, "dummy-key")
    assert result[0]["transport_minutes"] == 34
    assert result[0]["transit_summary"] == "버스 143 → 지하철 2호선 (환승 1회)"
    assert result[0]["transit_detail"] == [{"mode": "버스"}]
    assert "fare" not in result[0]  # 요금은 이번 범위에서 route_slots에 흘려보내지 않는다


# ── find_last_departure: 이분 탐색 · 자정 경계 ────────────────────────────


async def test_find_last_departure_no_route_at_all_returns_none():
    """탐색 시작 시각(22시)부터 경로가 없으면 그 구간엔 대중교통이 아예 없다는 뜻 — None."""
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(return_value=None),
    ) as mocked:
        result = await find_last_departure(
            AsyncMock(), *_GANGNAM, *_SEOUL_STATION, "dummy-key", date(2026, 8, 27)
        )
    assert result is None
    assert mocked.call_count == 1  # 시작점에서 바로 실패하니 더 탐색할 필요가 없다


async def test_find_last_departure_call_count_within_bound():
    """이분 탐색 호출 횟수가 6회 이하여야 한다(비용 방어)."""
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(return_value={"minutes": 30, "fare": 1500, "summary": "버스 143", "detail": []}),
    ) as mocked:
        result = await find_last_departure(
            AsyncMock(), *_GANGNAM, *_SEOUL_STATION, "dummy-key", date(2026, 8, 27)
        )
    assert result is not None
    assert mocked.call_count <= 6


async def test_find_last_departure_midnight_boundary_advances_date():
    """자정을 넘겨 다음 날 00:30에 막차가 끊기는 상황을 목으로 재현해, 이분 탐색이 찾아낸
    마지막 출발 시각(leave_by)의 날짜가 실제로 다음 날로 넘어가는지 검증한다.
    FFE #2 — 여기서 틀리면 자정 경계 처리 전체가 무의미해지는 가장 중요한 테스트다."""
    base_date = date(2026, 8, 27)
    # 8/28 00:30까지는 경로가 있고, 그 이후로는 끊긴다고 가정
    cutoff = datetime.combine(base_date, time(0, 0), tzinfo=_KST) + timedelta(hours=24.5)

    async def fake_route(client, lat1, lng1, lat2, lng2, api_key, search_dttm=None):
        at = datetime.strptime(search_dttm, "%Y%m%d%H%M").replace(tzinfo=_KST)
        if at <= cutoff:
            return {"minutes": 20, "fare": 1350, "summary": "지하철 2호선", "detail": []}
        return None

    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(side_effect=fake_route),
    ) as mocked:
        result = await find_last_departure(
            AsyncMock(), *_GANGNAM, *_SEOUL_STATION, "dummy-key", base_date
        )

    assert result is not None
    assert result["leave_by"].strftime("%Y%m%d") == "20260828"  # 다음 날짜로 넘어갔는지가 핵심
    assert result["leave_by"].tzinfo is not None  # KST aware datetime
    assert mocked.call_count <= 6

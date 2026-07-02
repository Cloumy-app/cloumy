from datetime import date, timedelta

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.route_service import _cache_key, _is_weather_sensitive, stream_route
from app.models.schemas import RouteGenRequest


def _make_req(**kwargs) -> RouteGenRequest:
    defaults = dict(
        city="서울", nights=2, group_type="solo",
        budget_level="mid", themes=[], hidden_gem_ratio=None,
    )
    return RouteGenRequest(**(defaults | kwargs))


def test_cache_key_format():
    key = _cache_key(_make_req())
    assert key.startswith("route:서울:2:solo:mid:")


def test_cache_key_themes_sorted():
    # 테마 순서가 달라도 동일한 캐시 키
    key1 = _cache_key(_make_req(themes=["카페", "등산"]))
    key2 = _cache_key(_make_req(themes=["등산", "카페"]))
    assert key1 == key2


def test_cache_key_default_ratio():
    # hidden_gem_ratio=None → 기본값 0.2
    key = _cache_key(_make_req(hidden_gem_ratio=None))
    assert key.endswith(":0.2")


def test_is_weather_sensitive_none_start_date():
    assert _is_weather_sensitive(None) is False


def test_is_weather_sensitive_within_window():
    today = date(2026, 7, 2)
    assert _is_weather_sensitive(today + timedelta(days=3), today=today) is True


def test_is_weather_sensitive_beyond_window():
    today = date(2026, 7, 2)
    assert _is_weather_sensitive(today + timedelta(days=10), today=today) is False


@pytest.mark.asyncio
async def test_stream_route_cache_hit():
    cached = (
        '{"day":1,"order":1,"place_id":"a","place_name":"A",'
        '"tip":"","duration_minutes":60,"budget_estimate":5000}\n'
    )
    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=cached)

    results = []
    async for line in stream_route(_make_req(), db=MagicMock(), redis=redis_mock):
        results.append(line)

    assert len(results) == 1
    assert "place_id" in results[0]

import json
from datetime import date, timedelta

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.documents import Document

import app.services.route_service as route_service
from app.services.route_service import _cache_key, _is_weather_sensitive, stream_route
from app.services.geo_clustering import cluster_candidates
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
    assert ":0.2:" in key


def test_cache_key_density_distinguishes():
    # density가 다르면 다른 캐시 키를 가져야 함 (밀도별 캐시 오염 방지)
    key_normal = _cache_key(_make_req(density="normal"))
    key_packed = _cache_key(_make_req(density="packed"))
    assert key_normal != key_packed
    assert key_normal.endswith(":normal")
    assert key_packed.endswith(":packed")


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


def _candidates() -> list[Document]:
    return [
        Document(page_content="A | 주소 | 태그: 맛집", metadata={"id": "p1", "name": "A", "lng": 129.0, "lat": 35.0, "avg_duration_minutes": 60, "is_hidden_gem": False}),
        Document(page_content="B | 주소 | 태그: 카페", metadata={"id": "p2", "name": "B", "lng": 129.01, "lat": 35.01, "avg_duration_minutes": 60, "is_hidden_gem": False}),
        Document(page_content="C | 주소 | 태그: 관광", metadata={"id": "p3", "name": "C", "lng": 129.02, "lat": 35.02, "avg_duration_minutes": 60, "is_hidden_gem": False}),
        Document(page_content="D | 주소 | 태그: 관광", metadata={"id": "p4", "name": "D", "lng": 129.03, "lat": 35.03, "avg_duration_minutes": 60, "is_hidden_gem": False}),
    ]


class _FakeAnthropicStream:
    """_anthropic.messages.stream()이 반환하는 async context manager를 흉내."""

    def __init__(self, chunks: list[str]):
        self._chunks = chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _gen(self):
        for chunk in self._chunks:
            yield chunk

    @property
    def text_stream(self):
        return self._gen()

    async def get_final_message(self):
        message = MagicMock()
        message.usage = MagicMock(
            cache_creation_input_tokens=0, cache_read_input_tokens=0, input_tokens=0
        )
        return message


@pytest.mark.asyncio
async def test_stream_route_day_boundary_reorders_per_day_and_cache_matches_stream():
    day1 = (
        '{"day":1,"order":1,"place_id":"p1","place_name":"A","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"day":1,"order":2,"place_id":"p2","place_name":"B","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
    )
    day2 = (
        '{"day":2,"order":1,"place_id":"p3","place_name":"C","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"day":2,"order":2,"place_id":"p4","place_name":"D","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
    )
    fake_stream = _FakeAnthropicStream([day1, day2])

    mock_pgvector = MagicMock()
    mock_pgvector.return_value.ainvoke = AsyncMock(return_value=_candidates())

    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.setex = AsyncMock()

    with patch.object(route_service, "PgvectorRetriever", mock_pgvector), \
         patch.object(route_service._anthropic.messages, "stream", return_value=fake_stream), \
         patch.object(route_service, "reorder_slots", wraps=route_service.reorder_slots) as reorder_spy:
        results = []
        async for line in stream_route(_make_req(), db=MagicMock(), redis=redis_mock):
            results.append(line)

    assert len(results) == 4
    # day 경계마다 한 번씩, day별로 분리된 인자로 reorder_slots가 호출돼야 함
    assert reorder_spy.call_count == 2
    first_day_lines = reorder_spy.call_args_list[0][0][0]
    second_day_lines = reorder_spy.call_args_list[1][0][0]
    assert all(json.loads(line)["day"] == 1 for line in first_day_lines)
    assert all(json.loads(line)["day"] == 2 for line in second_day_lines)

    # 캐시에 저장된 내용이 실제 yield된 내용과 완전히 동일해야 함 (스트림/캐시 불일치 해소 검증)
    cached_arg = redis_mock.setex.call_args[0][2]
    assert cached_arg == "".join(results)


def _clustered_candidates() -> list[Document]:
    # 서울 그룹 5곳 + 부산 그룹 5곳 = 총 10건 → 클러스터링 활성화 조건(>5건) 충족
    seoul = [
        Document(
            page_content=f"S{i} | 주소 | 태그: 관광",
            metadata={"id": f"s{i}", "name": f"S{i}", "lng": 127.0 + i * 0.001, "lat": 37.5 + i * 0.001,
                      "avg_duration_minutes": 60, "is_hidden_gem": False},
        )
        for i in range(5)
    ]
    busan = [
        Document(
            page_content=f"B{i} | 주소 | 태그: 관광",
            metadata={"id": f"b{i}", "name": f"B{i}", "lng": 129.0 + i * 0.001, "lat": 35.1 + i * 0.001,
                      "avg_duration_minutes": 60, "is_hidden_gem": False},
        )
        for i in range(5)
    ]
    return seoul + busan


@pytest.mark.asyncio
async def test_stream_route_activates_clustering_and_labels_candidates():
    mock_pgvector = MagicMock()
    mock_pgvector.return_value.ainvoke = AsyncMock(return_value=_clustered_candidates())
    fake_stream = _FakeAnthropicStream([])  # 빈 스트림 — 프롬프트 구성만 검증

    with patch.object(route_service, "PgvectorRetriever", mock_pgvector), \
         patch.object(route_service._anthropic.messages, "stream", return_value=fake_stream) as stream_mock:
        async for _ in stream_route(_make_req(nights=1), db=MagicMock(), redis=None):
            pass

    _, kwargs = stream_mock.call_args
    user_message = kwargs["messages"][0]["content"]
    assert "[구역 A]" in user_message
    assert "[구역 B]" in user_message
    assert "Day-구역 매핑" in user_message


@pytest.mark.asyncio
async def test_stream_route_hallucination_replacement_respects_day_region():
    # 클러스터링이 활성화된 상태에서 환각(hallucination) place_id가 발생하면,
    # 전체 후보가 아니라 그 Day에 배정된 구역(클러스터) 안에서만 대체돼야 한다.
    candidates = _clustered_candidates()
    clusters = cluster_candidates(candidates, k=2)  # route_service와 동일한 기본 seed(42)
    # 이 fixture/seed 조합에서 clusters[0]=서울(day1), clusters[1]=부산(day2)이다.
    # candidate_lookup의 "전체 후보 중 첫 번째" 항목(s0)은 day1(서울) 소속이므로,
    # 일부러 day2(부산)에서 환각을 발생시켜 지역 무시 버그가 있으면 s0(day1 소속)으로
    # 새는 것을 잡아낸다.
    day1_ids = {doc.metadata["id"] for doc in clusters[0]}
    day2_ids = {doc.metadata["id"] for doc in clusters[1]}

    valid_id = next(iter(day2_ids))
    day2 = (
        f'{{"day":2,"order":1,"place_id":"{valid_id}","place_name":"V","tip":"","duration_minutes":60,"budget_estimate":5000}}\n'
        '{"day":2,"order":2,"place_id":"fake-id","place_name":"없는 곳","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
    )
    fake_stream = _FakeAnthropicStream([day2])

    mock_pgvector = MagicMock()
    mock_pgvector.return_value.ainvoke = AsyncMock(return_value=candidates)

    with patch.object(route_service, "PgvectorRetriever", mock_pgvector), \
         patch.object(route_service._anthropic.messages, "stream", return_value=fake_stream):
        results = []
        async for line in stream_route(_make_req(nights=1), db=MagicMock(), redis=None):
            results.append(line)

    ids = {json.loads(r)["place_id"] for r in results}
    assert "fake-id" not in ids
    assert ids <= day2_ids
    assert not (ids & day1_ids)


@pytest.mark.asyncio
async def test_stream_route_day_summary_does_not_break_tsp_reorder():
    # day_summary 라인이 슬롯 사이에 섞여도 TSP day_buffer를 오염시키지 않고,
    # 슬롯들은 여전히 정상적으로 day별 TSP 재정렬 대상이 돼야 한다 (핵심 회귀 시나리오).
    day1 = (
        '{"type":"slot","day":1,"order":1,"place_id":"p1","place_name":"A","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"type":"slot","day":1,"order":2,"place_id":"p2","place_name":"B","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"type":"day_summary","day":1,"summary":"부산 해운대 일대를 둘러보는 하루"}\n'
    )
    day2 = (
        '{"type":"slot","day":2,"order":1,"place_id":"p3","place_name":"C","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"type":"slot","day":2,"order":2,"place_id":"p4","place_name":"D","tip":"","duration_minutes":60,"budget_estimate":5000}\n'
        '{"type":"day_summary","day":2,"summary":"감천문화마을과 근처 카페 골목을 둘러보는 하루"}\n'
    )
    fake_stream = _FakeAnthropicStream([day1, day2])

    mock_pgvector = MagicMock()
    mock_pgvector.return_value.ainvoke = AsyncMock(return_value=_candidates())

    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.setex = AsyncMock()

    with patch.object(route_service, "PgvectorRetriever", mock_pgvector), \
         patch.object(route_service._anthropic.messages, "stream", return_value=fake_stream), \
         patch.object(route_service, "reorder_slots", wraps=route_service.reorder_slots) as reorder_spy:
        results = []
        async for line in stream_route(_make_req(), db=MagicMock(), redis=redis_mock):
            results.append(line)

    # day_summary 2건 + 슬롯 4건 = 6줄 모두 결과에 포함돼야 함
    assert len(results) == 6
    summaries = [json.loads(r) for r in results if json.loads(r).get("type") == "day_summary"]
    assert len(summaries) == 2
    assert {s["day"] for s in summaries} == {1, 2}

    # reorder_slots(TSP)에 넘겨진 인자에는 day_summary 라인이 절대 섞이지 않아야 함
    for call in reorder_spy.call_args_list:
        day_buffer_arg = call[0][0]
        for line in day_buffer_arg:
            assert json.loads(line).get("type") != "day_summary"

    # 슬롯들은 여전히 day별로 정상 TSP 재정렬 대상이 됨 (회귀 없음)
    assert reorder_spy.call_count == 2


@pytest.mark.asyncio
async def test_pgvector_failure_falls_back_with_request_themes():
    req = _make_req(themes=["카페", "등산"])

    mock_pgvector = MagicMock()
    mock_pgvector.return_value.ainvoke = AsyncMock(side_effect=RuntimeError("pgvector 오류"))

    mock_postgis_cls = MagicMock()
    mock_postgis_cls.return_value.ainvoke = AsyncMock(return_value=[])

    with patch.object(route_service, "PgvectorRetriever", mock_pgvector), \
         patch.object(route_service, "PostgisTagRetriever", mock_postgis_cls):
        async for _ in stream_route(req, db=MagicMock(), redis=None):
            pass

    _, kwargs = mock_postgis_cls.call_args
    assert kwargs["tags"] == ["카페", "등산"]

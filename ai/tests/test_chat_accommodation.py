from datetime import date

import asyncpg
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.documents import Document

import app.services.chat_service as chat_service
from app.services.chat_service import _load_accommodations, _resolve_stay, _tool_get_route_status, _tool_search_nearby_places

# 챗봇 숙소 인지 — 프로액티브(_load_stay_distances)는 Day↔숙소 date-range 조인을 이미
# 하는데 챗봇(chat_service)만 숙소를 몰라 "숙소 근처" 질문에 되묻던 불일치를 고정한다.
# 이 파일이 지키는 것:
#   1) _resolve_stay 판단 규칙(날짜 매칭 → 1곳 폴백 → 그 외 None)이 그대로 유지된다
#   2) get_route_status가 day별 숙소를 date_matched=True일 때만 채운다(1곳 폴백을
#      전체 Day에 퍼뜨리는 틀린 단정을 만들지 않는다)
#   3) search_nearby_places의 origin="accommodation" 분기가 숙소 좌표를 검색 중심으로
#      쓰고, origin 생략 시 기존 폴백 체인이 100% 그대로 동작한다(하위호환)


def _db_mock() -> MagicMock:
    db = MagicMock(spec=asyncpg.Pool)
    return db


def _acc(name: str, check_in: date, check_out: date, lng: float = 127.0, lat: float = 37.0) -> dict:
    return {"name": name, "check_in_date": check_in, "check_out_date": check_out, "lng": lng, "lat": lat}


# ============================================================
# _resolve_stay — 순수 함수
# ============================================================

def test_resolve_stay_matches_by_date():
    accommodations = [
        _acc("롯데호텔", date(2026, 7, 8), date(2026, 7, 10)),
        _acc("남산힐호텔", date(2026, 7, 10), date(2026, 7, 12)),
    ]
    stay = _resolve_stay(accommodations, date(2026, 7, 10))
    assert stay["name"] == "남산힐호텔"
    assert stay["date_matched"] is True


def test_resolve_stay_single_fallback_marks_unmatched():
    # 날짜가 안 맞아도 숙소가 1곳뿐이면 그걸 쓰되, 근거가 약하다는 걸 date_matched=False로 표시한다.
    accommodations = [_acc("남산힐호텔", date(2026, 7, 14), date(2026, 7, 16))]
    stay = _resolve_stay(accommodations, date(2026, 7, 29))
    assert stay["name"] == "남산힐호텔"
    assert stay["date_matched"] is False


def test_resolve_stay_returns_none_when_ambiguous():
    # 숙소가 여러 곳인데 오늘 날짜가 어느 쪽과도 안 맞으면 임의로 고르지 않고 None.
    accommodations = [
        _acc("롯데호텔", date(2026, 7, 8), date(2026, 7, 10)),
        _acc("더잭슨", date(2026, 7, 8), date(2026, 7, 10)),
    ]
    assert _resolve_stay(accommodations, date(2026, 7, 20)) is None


def test_resolve_stay_returns_none_when_empty():
    assert _resolve_stay([], date(2026, 7, 20)) is None


# ============================================================
# get_route_status — day별 accommodation
# ============================================================

@pytest.mark.asyncio
async def test_route_status_marks_day_accommodation():
    route = {"id": "route-1", "destination": "서울", "start_date": date(2026, 7, 10), "end_date": date(2026, 7, 13)}
    estimated_slot = {"confidence": "low"}

    slots_rows = [
        {"day_number": 1, "order_index": 1, "start_time": None, "is_pinned": False, "place_name": "경복궁",
         "transport_to_next": None, "transport_minutes": None, "transit_summary": None},
        {"day_number": 2, "order_index": 1, "start_time": None, "is_pinned": False, "place_name": "명동",
         "transport_to_next": None, "transport_minutes": None, "transit_summary": None},
        {"day_number": 3, "order_index": 1, "start_time": None, "is_pinned": False, "place_name": "홍대",
         "transport_to_next": None, "transport_minutes": None, "transit_summary": None},
    ]
    summaries_rows: list[dict] = []
    # A: 07-10~07-11(Day1만 커버), B: 07-11~07-12(Day2만 커버) — Day3(07-12)는 둘 다 못 커버 + 2곳이라 모호함
    acc_rows = [
        {"name": "A호텔", "check_in_date": date(2026, 7, 10), "check_out_date": date(2026, 7, 11), "lng": 127.0, "lat": 37.0},
        {"name": "B호텔", "check_in_date": date(2026, 7, 11), "check_out_date": date(2026, 7, 12), "lng": 127.1, "lat": 37.1},
    ]

    db = _db_mock()
    db.fetch = AsyncMock(side_effect=[slots_rows, summaries_rows, acc_rows])

    result = await _tool_get_route_status(db, route, estimated_slot)

    assert result["accommodations"] == [
        {"name": "A호텔", "check_in_date": "2026-07-10", "check_out_date": "2026-07-11"},
        {"name": "B호텔", "check_in_date": "2026-07-11", "check_out_date": "2026-07-12"},
    ]
    days_by_number = {d["day"]: d for d in result["days"]}
    assert days_by_number[1]["accommodation"] == "A호텔"
    assert days_by_number[2]["accommodation"] == "B호텔"
    assert days_by_number[3]["accommodation"] is None  # 모호해서 None — 1곳 폴백을 여기서 쓰지 않는다


# ============================================================
# search_nearby_places — origin 분기
# ============================================================

def _candidate_docs() -> list[Document]:
    return [
        Document(
            page_content="카페A | 서울시 어딘가 | 태그: 카페",
            metadata={"id": "p1", "name": "카페A", "is_hidden_gem": False, "avg_duration_minutes": 30},
        )
    ]


@pytest.mark.asyncio
async def test_search_origin_accommodation_uses_stay_coords():
    route = {"id": "route-1", "destination": "서울"}
    db = _db_mock()
    # 날짜를 2020년으로 둔 건 의도적이다 — _tool_search_nearby_places가 내부에서
    # datetime.now(_KST)를 읽으므로, 실행일이 언제든 "오늘과 안 맞는 유일한 숙소"가 되어
    # 1곳 폴백(date_matched=False)이 결정적으로 재현된다. FFE #2가 도구 반환까지
    # 흘러나가는지를 여기서 고정한다(판단 규칙 자체는 _resolve_stay 단위 테스트가 덮는다).
    db.fetch = AsyncMock(return_value=[
        {"name": "남산힐호텔", "check_in_date": date(2020, 1, 1), "check_out_date": date(2020, 1, 3), "lng": 127.5, "lat": 37.5},
    ])

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=_candidate_docs())

    with patch.object(chat_service, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(chat_service, "_generate_place_reasons", AsyncMock(return_value={"p1": "숙소에서 가까워요"})):
        result = await _tool_search_nearby_places(db, route, None, {"confidence": "low"}, {"origin": "accommodation"})

    _, kwargs = mock_retriever_cls.call_args
    assert kwargs["city_coords"] == (127.5, 37.5)
    assert result["origin"]["kind"] == "accommodation"
    assert result["origin"]["name"] == "남산힐호텔"
    assert result["origin"]["date_matched"] is False  # 근거가 약하다는 표시가 모델까지 전달돼야 한다
    assert result["places"][0]["reason"] == "숙소에서 가까워요"


@pytest.mark.asyncio
async def test_search_origin_defaults_to_current():
    # origin을 생략하면 기존 폴백 체인(현재위치 → 추정슬롯 → 도시중심)이 그대로 동작해야 한다.
    route = {"id": "route-1", "destination": "서울"}
    db = _db_mock()
    db.fetch = AsyncMock()
    current_location = (126.9, 37.55)

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=_candidate_docs())

    with patch.object(chat_service, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(chat_service, "_generate_place_reasons", AsyncMock(return_value={})):
        result = await _tool_search_nearby_places(db, route, current_location, {"confidence": "low"}, {})

    _, kwargs = mock_retriever_cls.call_args
    assert kwargs["city_coords"] == current_location
    assert result["origin"] == {"kind": "current"}
    db.fetch.assert_not_called()  # 숙소 조회(_load_accommodations)가 아예 일어나지 않아야 한다


@pytest.mark.asyncio
async def test_search_origin_without_accommodation_returns_error():
    route = {"id": "route-1", "destination": "서울"}
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[])  # 등록된 숙소 없음

    result = await _tool_search_nearby_places(db, route, None, {"confidence": "low"}, {"origin": "accommodation"})

    assert result == {"places": [], "error": "등록된 숙소가 없어 숙소 기준으로 찾을 수 없습니다."}

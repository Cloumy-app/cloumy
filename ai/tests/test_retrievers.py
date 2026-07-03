import asyncpg
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.retrievers import PostgisTagRetriever


def _db_mock() -> MagicMock:
    # PostgisTagRetriever.db는 Pydantic 필드 타입이 asyncpg.Pool이라
    # spec 없는 MagicMock은 isinstance 검증에서 걸림
    db = MagicMock(spec=asyncpg.Pool)
    return db


def _row(is_hidden_gem: bool) -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "테스트장소",
        "category_tags": ["#맛집"],
        "address": "서울시 어딘가",
        "avg_duration_minutes": 60,
        "is_hidden_gem": is_hidden_gem,
        "lng": 127.0,
        "lat": 37.0,
    }


@pytest.mark.asyncio
async def test_hidden_gem_marker_included_when_true():
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[_row(True)])
    retriever = PostgisTagRetriever(db=db, city_coords=(127.0, 37.0), tags=["#맛집"])

    docs = await retriever._aget_relevant_documents("")

    assert "Hidden Gem" in docs[0].page_content
    assert docs[0].metadata["is_hidden_gem"] is True


@pytest.mark.asyncio
async def test_hidden_gem_marker_absent_when_false():
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[_row(False)])
    retriever = PostgisTagRetriever(db=db, city_coords=(127.0, 37.0), tags=["#맛집"])

    docs = await retriever._aget_relevant_documents("")

    assert "Hidden Gem" not in docs[0].page_content
    assert docs[0].metadata["is_hidden_gem"] is False


@pytest.mark.asyncio
async def test_tags_without_hash_prefix_are_normalized():
    # places.category_tags는 항상 "#"로 시작 — 호출부가 "#" 없이 넘겨도
    # 쿼리에는 정규화된 "#" 포함 태그로 전달돼야 매칭된다.
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[_row(False)])
    retriever = PostgisTagRetriever(db=db, city_coords=(127.0, 37.0), tags=["맛집", "#야경"])

    await retriever._aget_relevant_documents("")

    # 목(mock)이 1건만 반환해 3건 미만 확장 로직이 추가 호출을 트리거하므로,
    # 태그 정규화를 확인하려는 최초 호출(첫 번째 call)의 인자를 본다.
    first_call_args = db.fetch.call_args_list[0]
    passed_tags = first_call_args.args[-1]
    assert passed_tags == ["#맛집", "#야경"]

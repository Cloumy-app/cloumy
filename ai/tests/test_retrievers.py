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

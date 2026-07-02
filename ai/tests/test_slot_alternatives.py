import json

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.documents import Document

import app.routes.slot_alternatives as slot_alt
from app.routes.slot_alternatives import SlotAlternativesRequest, get_slot_alternatives


def _candidates() -> list[Document]:
    return [
        Document(
            page_content="실제장소 | 주소 | 태그: 맛집",
            metadata={"id": "real-1", "name": "실제장소", "lng": 129.0, "lat": 35.0},
        ),
    ]


class _FakeResponse:
    def __init__(self, text: str):
        self.content = [MagicMock(text=text)]


class _FakeRequest:
    """request.app.state.db 접근만 필요 — fastapi.Request 없이 최소 구현."""

    def __init__(self, db):
        self.app = MagicMock()
        self.app.state.db = db


@pytest.mark.asyncio
async def test_hallucinated_place_id_filtered_and_coords_from_db():
    req = SlotAlternativesRequest(
        slot_id="s1", place_name="현재장소", destination="서울", tags=[], nearby_slots=[],
    )
    fake_request = _FakeRequest(db=MagicMock())

    # LLM이 실제 후보에 없는 place_id를 하나 섞어서 반환 (환각)
    hallucinated_response = json.dumps([
        {"place_id": "fake-id-does-not-exist", "reason": "환각", "estimated_cost": 99999},
        {"place_id": "real-1", "reason": "진짜 후보", "estimated_cost": 10000},
    ])

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=_candidates())

    with patch.object(slot_alt, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(slot_alt._anthropic.messages, "create", AsyncMock(return_value=_FakeResponse(hallucinated_response))):
        result = await get_slot_alternatives(req, fake_request)

    assert len(result) == 1
    assert result[0].place_id == "real-1"
    # 좌표는 LLM 응답이 아니라 DB 후보값에서 와야 함
    assert result[0].lat == 35.0
    assert result[0].lng == 129.0


@pytest.mark.asyncio
async def test_no_candidates_skips_llm_call():
    req = SlotAlternativesRequest(
        slot_id="s1", place_name="현재장소", destination="서울", tags=[], nearby_slots=[],
    )
    fake_request = _FakeRequest(db=MagicMock())

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=[])
    mock_create = AsyncMock()

    with patch.object(slot_alt, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(slot_alt._anthropic.messages, "create", mock_create):
        result = await get_slot_alternatives(req, fake_request)

    assert result == []
    mock_create.assert_not_called()

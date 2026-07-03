import json

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.documents import Document

import app.routes.slot_alternatives as slot_alt
from app.routes.slot_alternatives import SlotAlternativesRequest, get_slot_alternatives


def _candidates(n: int = 1) -> list[Document]:
    return [
        Document(
            page_content=f"장소{i + 1} | 주소{i + 1} | 태그: 맛집",
            metadata={"id": f"real-{i + 1}", "name": f"장소{i + 1}", "lng": 129.0 + i, "lat": 35.0 + i},
        )
        for i in range(n)
    ]


class _FakeResponse:
    def __init__(self, text: str):
        self.content = [MagicMock(text=text)]
        self.usage = MagicMock(
            cache_creation_input_tokens=0, cache_read_input_tokens=0, input_tokens=0
        )


class _FakeRequest:
    """request.app.state.db 접근만 필요 — fastapi.Request 없이 최소 구현."""

    def __init__(self, db):
        self.app = MagicMock()
        self.app.state.db = db


@pytest.mark.asyncio
async def test_valid_index_resolved_to_real_candidate():
    req = SlotAlternativesRequest(
        slot_id="s1", place_name="현재장소", destination="서울", tags=[], nearby_slots=[],
    )
    fake_request = _FakeRequest(db=MagicMock())

    response = json.dumps([{"index": 2, "reason": "진짜 후보", "estimated_cost": 10000}])

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=_candidates(2))

    with patch.object(slot_alt, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(slot_alt._anthropic.messages, "create", AsyncMock(return_value=_FakeResponse(response))):
        result = await get_slot_alternatives(req, fake_request)

    # index=2는 두 번째 후보(real-2)를 가리킴, 나머지 한 자리는 백필로 채워짐
    assert len(result) == 2
    assert result[0].place_id == "real-2"
    assert result[0].reason == "진짜 후보"
    assert result[0].estimated_cost == 10000
    # 좌표는 LLM 응답이 아니라 DB 후보값에서 와야 함
    assert result[0].lat == 36.0
    assert result[0].lng == 130.0


@pytest.mark.asyncio
async def test_out_of_range_index_dropped_and_backfilled():
    req = SlotAlternativesRequest(
        slot_id="s1", place_name="현재장소", destination="서울", tags=[], nearby_slots=[],
    )
    fake_request = _FakeRequest(db=MagicMock())

    # 후보가 1개뿐인데 index=99를 반환(환각) — 범위를 벗어나 드롭되고 백필로 채워져야 함
    response = json.dumps([{"index": 99, "reason": "환각", "estimated_cost": 99999}])

    mock_retriever_cls = MagicMock()
    mock_retriever_cls.return_value.ainvoke = AsyncMock(return_value=_candidates(1))

    with patch.object(slot_alt, "PostgisTagRetriever", mock_retriever_cls), \
         patch.object(slot_alt._anthropic.messages, "create", AsyncMock(return_value=_FakeResponse(response))):
        result = await get_slot_alternatives(req, fake_request)

    assert len(result) == 1
    assert result[0].place_id == "real-1"
    assert result[0].estimated_cost == 0
    assert "맛집" in result[0].reason
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

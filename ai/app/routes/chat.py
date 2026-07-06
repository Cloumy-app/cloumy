import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.chat_service import RouteNotFoundError, handle_chat

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["chat"])


class ChatLocation(BaseModel):
    lat: float
    lng: float


class ChatRequest(BaseModel):
    user_id: str
    route_id: str
    message: str
    current_location: ChatLocation | None = None
    language: str | None = None  # ko/en/ja/zh — 앱 설정 언어(사용자 메시지 언어가 애매할 때 폴백)


class PlaceCard(BaseModel):
    place_id: str
    name: str
    tags: str
    is_hidden_gem: bool
    avg_duration_minutes: int | None = None
    reason: str


class EstimatedSlot(BaseModel):
    slot_id: str
    day: int
    order_index: int


class ChatResponse(BaseModel):
    reply: str
    places: list[PlaceCard] | None = None
    estimated_slot: EstimatedSlot | None = None


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    db = request.app.state.db
    redis = getattr(request.app.state, "redis", None)

    location = (
        (req.current_location.lng, req.current_location.lat)
        if req.current_location
        else None
    )

    try:
        reply, places, estimated_slot = await handle_chat(
            db=db,
            redis=redis,
            user_id=req.user_id,
            route_id=req.route_id,
            user_message=req.message,
            current_location=location,
            language=req.language,
        )
    except RouteNotFoundError:
        logger.warning("챗봇 요청 — 존재하지 않거나 소유하지 않은 route_id: %s", req.route_id)
        raise HTTPException(status_code=404, detail="여행 일정을 찾을 수 없습니다.")

    return ChatResponse(reply=reply, places=places, estimated_slot=estimated_slot)

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.models.schemas import ProactiveContext
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
    # 프로액티브 배너 탭 직후 첫 메시지에만 실려온다. 앱은 type+params만 보내고 문장은
    # 서버가 조립한다(app.models.schemas.ProactiveContext) — 완성 문장을 그대로 받아 붙이면
    # 시스템 프롬프트에 임의 지시를 주입하는 통로가 된다(결함 4).
    proactive: ProactiveContext | None = None


class PlaceCard(BaseModel):
    place_id: str
    name: str
    tags: str
    is_hidden_gem: bool
    avg_duration_minutes: int | None = None
    # 기준점(현재 위치·숙소·일정 장소)에서의 거리. 반경 안에 후보가 없어 더 멀리까지 찾은
    # 경우를 앱이 판별할 수 있게 내려준다 — 지금은 Spring·앱이 쓰지 않지만, 답변 문장에만
    # 있으면 카드 목록과 문장이 어긋난다.
    distance_m: int | None = None
    reason: str


class EstimatedSlot(BaseModel):
    slot_id: str
    day: int
    order_index: int


class Insertion(BaseModel):
    day: int
    after_slot_id: str | None = None
    source: str  # "conversation" | "estimated" | "default"


class ChatResponse(BaseModel):
    reply: str
    places: list[PlaceCard] | None = None
    estimated_slot: EstimatedSlot | None = None
    insertion: Insertion | None = None


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
        reply, places, estimated_slot, insertion = await handle_chat(
            db=db,
            redis=redis,
            user_id=req.user_id,
            route_id=req.route_id,
            user_message=req.message,
            current_location=location,
            language=req.language,
            proactive=req.proactive,
        )
    except RouteNotFoundError:
        logger.warning("챗봇 요청 — 존재하지 않거나 소유하지 않은 route_id: %s", req.route_id)
        raise HTTPException(status_code=404, detail="여행 일정을 찾을 수 없습니다.")

    return ChatResponse(reply=reply, places=places, estimated_slot=estimated_slot, insertion=insertion)

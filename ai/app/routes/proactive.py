import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.chat_service import RouteNotFoundError
from app.services.proactive_service import get_intervention

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["proactive"])


class Intervention(BaseModel):
    type: str
    params: dict


class ProactiveResponse(BaseModel):
    intervention: Intervention | None = None


@router.get("/proactive", response_model=ProactiveResponse)
async def proactive(user_id: str, route_id: str, request: Request):
    db = request.app.state.db
    redis = getattr(request.app.state, "redis", None)

    try:
        result = await get_intervention(db, redis, user_id, route_id)
    except RouteNotFoundError:
        logger.warning("프로액티브 요청 — 존재하지 않거나 소유하지 않은 route_id: %s", route_id)
        raise HTTPException(status_code=404, detail="여행 일정을 찾을 수 없습니다.")

    # 계측 — 베타에서 종류별 탭률을 재려면 최소한 "떴다"는 사실이 로그에 남아야 한다(§계측)
    if result is not None:
        logger.info("[proactive] shown type=%s route=%s user=%s", result["type"], route_id, user_id)

    return ProactiveResponse(intervention=result)

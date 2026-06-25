import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.schemas import RouteGenRequest
from app.services.route_service import CITY_CENTERS, stream_route

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["routes"])


@router.post("/routes/generate")
async def generate_route(req: RouteGenRequest, request: Request):
    if req.city not in CITY_CENTERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"지원하지 않는 도시입니다: '{req.city}'. "
                f"지원 도시: {sorted(CITY_CENTERS.keys())}"
            ),
        )

    db = request.app.state.db
    redis = getattr(request.app.state, "redis", None)

    async def _generate():
        # gen 참조 보관 → GeneratorExit 시 명시적 aclose()로 Anthropic HTTP 연결 보장
        gen = stream_route(req, db, redis)
        try:
            async for chunk in gen:
                yield chunk
        except GeneratorExit:
            await gen.aclose()

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff"},
    )

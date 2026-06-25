import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config.database import create_pool
from app.config.redis import create_redis
from app.config.settings import settings
from app.routes import route_gen
from app.services.route_service import close_ai_clients

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 앱 시작 — DB 풀 생성 후 app.state에 저장 (라우터에서 request.app.state.db로 접근)
    logger.info("DB 커넥션 풀 생성 중...")
    app.state.db = await create_pool(settings.asyncpg_url)
    app.state.redis = create_redis(settings.redis_url)
    logger.info("DB 커넥션 풀 준비 완료")
    yield
    # 앱 종료 — DB 풀 및 AI 클라이언트 반환
    await app.state.db.close()
    await app.state.redis.aclose()
    await close_ai_clients()
    logger.info("DB 커넥션 풀 및 AI 클라이언트 종료")


app = FastAPI(
    title="Cloumy AI Service",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def internal_key_middleware(request: Request, call_next):
    # /health 는 Docker·AWS 헬스체크 도구가 키 없이 호출하므로 통과 허용
    if request.url.path == "/health":
        return await call_next(request)

    key = request.headers.get("X-Internal-Key")
    if key != settings.internal_api_key:
        logger.warning("잘못된 X-Internal-Key | path=%s", request.url.path)
        return JSONResponse(
            status_code=403,
            content={"detail": "인가되지 않은 요청입니다."},
        )

    return await call_next(request)


app.include_router(route_gen.router)


@app.get("/health")
async def health(request: Request):
    try:
        async with request.app.state.db.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        logger.error("헬스체크 DB 오류: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "error", "db": "disconnected"},
        )

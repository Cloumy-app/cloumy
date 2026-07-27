import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config.database import create_pool
from app.config.redis import create_redis
from app.config.settings import settings
from app.routes import chat, place_translate, proactive, route_gen, slot_alternatives, slot_transport
from app.services.route_service import close_ai_clients


class SecretMaskingFilter(logging.Filter):
    """URL 쿼리에 실려 로그로 새는 시크릿을 가린다.

    httpx가 요청 URL 전체를 INFO로 남기는데 OpenWeatherMap은 API 키를 appid 쿼리
    파라미터로 받는다. 그대로 두면 `docker logs`에 키가 평문으로 남는다.
    로그 자체를 끄면 외부 호출 추적이 어려워지므로 값만 마스킹한다.
    """

    _PATTERN = re.compile(r"(appid=)[^&\s\"']+")

    def _mask(self, value: object) -> object:
        # httpx는 URL을 str이 아닌 httpx.URL 객체로 넘긴다 — 문자열화해서 검사하고,
        # 마스킹할 게 없으면 원본 객체를 그대로 돌려줘 기존 포맷 동작을 유지한다.
        text = value if isinstance(value, str) else str(value)
        masked = self._PATTERN.sub(r"\1***", text)
        return masked if masked != text else value

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._PATTERN.sub(r"\1***", record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(self._mask(arg) for arg in record.args)
        return True


logging.basicConfig(level=logging.INFO)
# 루트 핸들러에 붙여야 httpx 등 하위 로거에서 전파된 레코드까지 필터를 탄다
for _handler in logging.getLogger().handlers:
    _handler.addFilter(SecretMaskingFilter())

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
app.include_router(slot_alternatives.router)
app.include_router(slot_transport.router)
app.include_router(chat.router)
app.include_router(place_translate.router)
app.include_router(proactive.router)


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

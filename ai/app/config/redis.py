import redis.asyncio as aioredis
from redis.asyncio import Redis


def create_redis(url: str) -> Redis:
    # from_url은 동기 반환 — 실제 연결은 첫 명령 시 lazy하게 이뤄짐
    return aioredis.from_url(url, decode_responses=True)

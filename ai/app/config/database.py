import asyncpg
from asyncpg import Pool
from pgvector.asyncpg import register_vector


async def _init_connection(conn: asyncpg.Connection) -> None:
    # 모든 새 커넥션에 pgvector 'vector' 타입 코덱 등록
    # 미등록 시 embedding <=> $1 쿼리에서 "unknown type" 에러 발생
    await register_vector(conn)


async def create_pool(dsn: str) -> Pool:
    return await asyncpg.create_pool(
        dsn,
        min_size=2,
        max_size=10,
        command_timeout=5,   # 5초 초과 쿼리는 자동 취소
        init=_init_connection,
    )

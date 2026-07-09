import logging

import asyncpg
import numpy as np
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from openai import AsyncOpenAI
from pydantic import ConfigDict

logger = logging.getLogger(__name__)


class PostgisTagRetriever(BaseRetriever):
    """PostGIS ST_DWithin + category_tags 배열 필터 기반 장소 후보 검색기."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    db: asyncpg.Pool
    city_coords: tuple[float, float]  # (lng, lat)
    tags: list[str]
    radius_m: int = 30000

    async def _fetch(self, radius_m: int, use_tags: bool) -> list[asyncpg.Record]:
        lng, lat = self.city_coords
        if use_tags:
            # places.category_tags는 항상 "#"로 시작(예: #관광, #야경)하는데, 호출부(프론트
            # 테마 선택 등)가 "#" 없이 넘기는 경우가 있어 그대로 비교하면 항상 0건이 된다.
            normalized_tags = [t if t.startswith("#") else f"#{t}" for t in self.tags]
            return await self.db.fetch(
                """
                SELECT
                    id, name, category_tags, address,
                    avg_duration_minutes, is_hidden_gem,
                    ST_X(location::geometry) AS lng,
                    ST_Y(location::geometry) AS lat
                FROM places
                WHERE ST_DWithin(
                    location::geography,
                    ST_MakePoint($1, $2)::geography,
                    $3
                )
                AND category_tags && $4::text[]
                AND is_active = true
                AND is_curated = true
                ORDER BY RANDOM()
                LIMIT 80
                """,
                lng, lat, radius_m, normalized_tags,
            )
        return await self.db.fetch(
            """
            SELECT
                id, name, category_tags, address,
                avg_duration_minutes, is_hidden_gem,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
            FROM places
            WHERE ST_DWithin(
                location::geography,
                ST_MakePoint($1, $2)::geography,
                $3
            )
            AND is_active = true
            AND is_curated = true
            ORDER BY RANDOM()
            LIMIT 80
            """,
            lng, lat, radius_m,
        )

    async def _aget_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        use_tags = bool(self.tags)
        rows = await self._fetch(self.radius_m, use_tags)

        # 후보 3건 미만 → 반경 50km로 자동 확장 (대안 추천 등 최소 개수 보장이 필요한 호출부 대응)
        if len(rows) < 3 and self.radius_m < 50000:
            logger.info("후보 %d건 — 반경 %dm → 50000m 확장", len(rows), self.radius_m)
            rows = await self._fetch(50000, use_tags)

        # 여전히 3건 미만이고 태그 필터를 썼다면 태그 제거 후 재시도
        if len(rows) < 3 and use_tags:
            logger.info("확장 후에도 %d건 — 태그 필터 제거 재시도", len(rows))
            rows = await self._fetch(50000, use_tags=False)

        return [
            Document(
                page_content=(
                    f"{row['name']} | {row['address'] or '주소 없음'} | "
                    f"태그: {', '.join(row['category_tags'] or [])}"
                    + (" | Hidden Gem" if row["is_hidden_gem"] else "")
                ),
                metadata={
                    "id": str(row["id"]),
                    "name": row["name"],
                    "lng": float(row["lng"]),
                    "lat": float(row["lat"]),
                    "avg_duration_minutes": row["avg_duration_minutes"],
                    "is_hidden_gem": row["is_hidden_gem"],
                },
            )
            for row in rows
        ]

    def _get_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        raise NotImplementedError("PostgisTagRetriever는 비동기 전용입니다 — _aget_relevant_documents를 사용하세요")


class PgvectorRetriever(BaseRetriever):
    """OpenAI 임베딩 유사도 + PostGIS 반경 기반 장소 후보 검색기 (Phase B)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    db: asyncpg.Pool
    openai_client: AsyncOpenAI
    city_coords: tuple[float, float]  # (lng, lat)
    radius_m: int = 30000

    async def _embed(self, text: str) -> np.ndarray:
        resp = await self.openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return np.array(resp.data[0].embedding, dtype=np.float32)

    async def _fetch(self, query_vec: np.ndarray, radius_m: int) -> list[asyncpg.Record]:
        lng, lat = self.city_coords
        async with self.db.acquire() as conn:
            async with conn.transaction():
                # ivfflat.probes: recall ↑ vs 속도 트레이드오프 (기본값 1 → 10으로 상향)
                await conn.execute("SET LOCAL ivfflat.probes = 10")
                return await conn.fetch(
                    """
                    SELECT
                        id, name, category_tags, address,
                        avg_duration_minutes, is_hidden_gem,
                        ST_X(location::geometry) AS lng,
                        ST_Y(location::geometry) AS lat
                    FROM places
                    WHERE ST_DWithin(
                        location::geography,
                        ST_MakePoint($2, $3)::geography,
                        $4
                    )
                    AND is_active = true
                    AND is_curated = true
                    AND embedding IS NOT NULL
                    ORDER BY embedding <=> $1::vector
                    LIMIT 80
                    """,
                    query_vec, lng, lat, radius_m,
                )

    async def _aget_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        query_vec = await self._embed(query)
        rows = await self._fetch(query_vec, self.radius_m)

        if not rows and self.radius_m < 50000:
            logger.info("pgvector 후보 0건 — 반경 %dm → 50000m 확장", self.radius_m)
            rows = await self._fetch(query_vec, 50000)

        logger.info("PgvectorRetriever: 후보 %d건 (반경 %dm)", len(rows), self.radius_m)

        return [
            Document(
                page_content=(
                    f"{row['name']} | {row['address'] or '주소 없음'} | "
                    f"태그: {', '.join(row['category_tags'] or [])}"
                    + (" | Hidden Gem" if row["is_hidden_gem"] else "")
                ),
                metadata={
                    "id": str(row["id"]),
                    "name": row["name"],
                    "lng": float(row["lng"]),
                    "lat": float(row["lat"]),
                    "avg_duration_minutes": row["avg_duration_minutes"],
                    "is_hidden_gem": row["is_hidden_gem"],
                },
            )
            for row in rows
        ]

    def _get_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        raise NotImplementedError("PgvectorRetriever는 비동기 전용입니다 — _aget_relevant_documents를 사용하세요")


def describe_candidate(doc: Document) -> str:
    """검색된 후보 장소를 한줄로 설명한다(LLM 호출 없이 결정론적) — Pin&Reshuffle 대안 추천과
    챗봇 추천 카드가 동일한 방식으로 "왜 이 장소인지"를 보여주기 위해 공유하는 함수.
    page_content가 "이름 | 주소 | 태그: ..." 형식이므로 태그 부분만 뽑아 재사용."""
    tag_part = next(
        (p for p in doc.page_content.split(" | ") if p.startswith("태그:")), None
    )
    if tag_part:
        return f"{tag_part.replace('태그: ', '')} · 동선상 가까운 위치"
    return "동선상 가까운 대안 장소"

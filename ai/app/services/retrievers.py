import logging

import asyncpg
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
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
            return await self.db.fetch(
                """
                SELECT
                    id, name, category_tags, address,
                    avg_duration_minutes,
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
                ORDER BY RANDOM()
                LIMIT 50
                """,
                lng, lat, radius_m, self.tags,
            )
        return await self.db.fetch(
            """
            SELECT
                id, name, category_tags, address,
                avg_duration_minutes,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
            FROM places
            WHERE ST_DWithin(
                location::geography,
                ST_MakePoint($1, $2)::geography,
                $3
            )
            AND is_active = true
            ORDER BY RANDOM()
            LIMIT 50
            """,
            lng, lat, radius_m,
        )

    async def _aget_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        use_tags = bool(self.tags)
        rows = await self._fetch(self.radius_m, use_tags)

        # 후보 0건 → 반경 50km로 자동 확장
        if not rows and self.radius_m < 50000:
            logger.info("후보 0건 — 반경 %dm → 50000m 확장", self.radius_m)
            rows = await self._fetch(50000, use_tags)

        # 여전히 0건이고 태그 필터를 썼다면 태그 제거 후 재시도
        if not rows and use_tags:
            logger.info("태그 적용 후에도 0건 — 태그 필터 제거 재시도")
            rows = await self._fetch(50000, use_tags=False)

        return [
            Document(
                page_content=(
                    f"{row['name']} | {row['address'] or '주소 없음'} | "
                    f"태그: {', '.join(row['category_tags'] or [])}"
                ),
                metadata={
                    "id": str(row["id"]),
                    "name": row["name"],
                    "lng": float(row["lng"]),
                    "lat": float(row["lat"]),
                    "avg_duration_minutes": row["avg_duration_minutes"],
                },
            )
            for row in rows
        ]

    def _get_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        raise NotImplementedError("PostgisTagRetriever는 비동기 전용입니다 — _aget_relevant_documents를 사용하세요")

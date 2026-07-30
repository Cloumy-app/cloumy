import logging
from typing import Literal

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
    # 기준점에서 가까운 순으로 뽑을지, 반경 안에서 무작위로 뽑을지.
    #
    # 기본값이 "random"인 게 중요하다 — 루트 생성 폴백(route_service.py)은 도시 중심에서
    # 반경 30km 후보를 LLM에 넘기는데, 거리순으로 바꾸면 매번 도심 근처 장소만 올라와
    # 루트가 단조로워진다. 반면 챗봇 "근처 검색"과 슬롯 대안은 기준점 근처가 목적 자질이라
    # 무작위면 안 된다. 실측: 숙소 기준 카페 검색이 5.1km와 27.3km(인천)를 나란히 반환했다.
    sort: Literal["random", "distance"] = "random"

    def _order_by(self) -> str:
        """ORDER BY 절만 조립한다. 정렬 기준은 SQL 구문 위치라 파라미터 바인딩($n)이
        불가능해 문자열로 넣어야 하는데, self.sort가 Literal 화이트리스트라 열거된 두 값
        밖은 Pydantic 단계에서 막힌다 — _tool_search_nearby_places가 origin 분기를
        화이트리스트 비교로 처리하는 것과 같은 근거다."""
        return "distance_m" if self.sort == "distance" else "RANDOM()"

    async def _fetch(self, radius_m: int, use_tags: bool) -> list[asyncpg.Record]:
        lng, lat = self.city_coords
        # 거리는 정렬에 쓰지 않을 때도 항상 SELECT한다 — 호출부(챗봇 답변, 후보 설명 문구)가
        # "얼마나 먼지"를 알아야 "근처"라고 단정하지 않을 수 있다.
        if use_tags:
            # places.category_tags는 항상 "#"로 시작(예: #관광, #야경)하는데, 호출부(프론트
            # 테마 선택 등)가 "#" 없이 넘기는 경우가 있어 그대로 비교하면 항상 0건이 된다.
            normalized_tags = [t if t.startswith("#") else f"#{t}" for t in self.tags]
            return await self.db.fetch(
                f"""
                SELECT
                    id, name, category_tags, address,
                    avg_duration_minutes, is_hidden_gem,
                    ST_X(location::geometry) AS lng,
                    ST_Y(location::geometry) AS lat,
                    ST_Distance(location::geography, ST_MakePoint($1, $2)::geography) AS distance_m
                FROM places
                WHERE ST_DWithin(
                    location::geography,
                    ST_MakePoint($1, $2)::geography,
                    $3
                )
                AND category_tags && $4::text[]
                AND is_active = true
                AND is_curated = true
                ORDER BY {self._order_by()}
                LIMIT 80
                """,
                lng, lat, radius_m, normalized_tags,
            )
        return await self.db.fetch(
            f"""
            SELECT
                id, name, category_tags, address,
                avg_duration_minutes, is_hidden_gem,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                ST_Distance(location::geography, ST_MakePoint($1, $2)::geography) AS distance_m
            FROM places
            WHERE ST_DWithin(
                location::geography,
                ST_MakePoint($1, $2)::geography,
                $3
            )
            AND is_active = true
            AND is_curated = true
            ORDER BY {self._order_by()}
            LIMIT 80
            """,
            lng, lat, radius_m,
        )

    async def _aget_relevant_documents(self, query: str, *, run_manager=None) -> list[Document]:
        use_tags = bool(self.tags)
        rows = await self._fetch(self.radius_m, use_tags)
        # 태그·기준점·건수를 남긴다 — 아래 폴백이 걸렸을 때 "데이터가 없어서"인지 "태그가
        # 안 맞아서"인지 로그만으로 갈릴 수 있어야 한다. 이게 없어서 "근처가 아닌 곳이
        # 추천된다"는 증상의 원인을 찾을 때 계측을 새로 넣어야 했다.
        logger.info(
            "장소 검색 tags=%s center=%s radius=%dm sort=%s → %d건",
            self.tags, self.city_coords, self.radius_m, self.sort, len(rows),
        )

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
                    "distance_m": float(row["distance_m"]),
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
    page_content가 "이름 | 주소 | 태그: ..." 형식이므로 태그 부분만 뽑아 재사용.

    거리를 알 수 있으면 "동선상 가까운 위치" 대신 실제 거리를 쓴다 — 반경 안에 후보가
    없어 50km까지 확장된 결과에도 이 문구가 붙어 27km 떨어진 장소를 "가까운 위치"라고
    설명하고 있었다. metadata에 distance_m이 없는 경로(PgvectorRetriever 등)는 기존
    문구로 폴백한다."""
    tag_part = next(
        (p for p in doc.page_content.split(" | ") if p.startswith("태그:")), None
    )
    tags = tag_part.replace("태그: ", "") if tag_part else None

    distance_m = doc.metadata.get("distance_m")
    where = f"{distance_m / 1000:.1f}km 거리" if distance_m is not None else "동선상 가까운 위치"

    if tags:
        return f"{tags} · {where}"
    return f"{where}의 대안 장소"

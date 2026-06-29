#!/usr/bin/env python3
"""
카카오 로컬 보충 수집기
TourAPI 미수집 맛집/카페/핫플 보강 + TourAPI 좌표 100m 이상 오차 교정.

실행:
  cd ai && python -m scripts.collect_kakao
  cd ai && python -m scripts.collect_kakao --dry-run
  cd ai && python -m scripts.collect_kakao --city 부산
"""
import argparse
import asyncio
import logging
import os
from pathlib import Path
from typing import TypedDict

import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from app.config.city_centers import CITY_CENTERS  # noqa: E402
from app.config.database import create_pool  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_KAKAO_KEY = os.environ.get("KAKAO_REST_API_KEY", "")
_BASE_URL = "https://dapi.kakao.com/v2/local/search"

# 카카오 카테고리 코드 → places.category_tags 매핑
CATEGORY_TAGS: dict[str, list[str]] = {
    "FD6": ["#먹방", "#식당"],
    "CE7": ["#카페"],
    "AT4": ["#랜드마크", "#관광명소"],
    "CT1": ["#실내", "#역사"],
}

# 도시 키워드 검색 템플릿 — TourAPI 미수집 트렌딩 장소 보강
KEYWORD_TEMPLATES = [
    "{city} 현지인 맛집",
    "{city} 숨은 카페",
    "{city} 핫플레이스",
    "{city} 로컬 맛집",
    "{city} 숨은 명소",
]

# 중복 판정 반경 (m) — 교정 임계값(100m)보다 커야 교정 분기에 도달 가능
_DEDUP_RADIUS_M = 150
# 좌표 교정 임계값 (m) — TourAPI 좌표가 이보다 어긋나면 카카오 좌표로 UPDATE
_COORD_CORRECT_THRESHOLD_M = 100


class PlaceRow(TypedDict):
    name: str
    lng: float
    lat: float
    address: str | None
    tags: list[str]


async def _kakao_get(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    endpoint: str,
    params: dict[str, str | float | int],
) -> dict[str, object]:
    """단일 카카오 API 호출. 429 시 sem 해제 후 1초 대기, 1회 재시도."""
    headers = {"Authorization": f"KakaoAK {_KAKAO_KEY}"}
    async with sem:
        r = await client.get(
            f"{_BASE_URL}/{endpoint}",
            headers=headers,
            params=params,
            timeout=10,
        )

    if r.status_code == 429:
        log.warning("429 Rate Limit — 1초 대기 후 재시도")
        await asyncio.sleep(1)  # sem 밖에서 대기 — 다른 코루틴이 슬롯 사용 가능
        async with sem:         # 재시도도 sem 안에서 Rate Limit 준수
            r = await client.get(
                f"{_BASE_URL}/{endpoint}",
                headers=headers,
                params=params,
                timeout=10,
            )

    r.raise_for_status()
    return r.json()


async def _kakao_paginate(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    endpoint: str,
    base_params: dict[str, str | float | int],
    context: str,
) -> list[dict[str, object]]:
    """카카오 API 전 페이지 수집 (최대 45페이지 × 15건 = 675건)."""
    results: list[dict[str, object]] = []
    for page in range(1, 46):
        try:
            data = await _kakao_get(client, sem, endpoint, {**base_params, "size": 15, "page": page})
        except Exception as e:
            log.warning("%s page=%d: %s", context, page, e)
            break
        results.extend(data.get("documents", []))
        if data.get("meta", {}).get("is_end"):
            break
    return results


async def kakao_keyword_search(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    query: str,
    x: float,
    y: float,
) -> list[dict[str, object]]:
    return await _kakao_paginate(
        client, sem, "keyword.json",
        {"query": query, "x": x, "y": y, "radius": 20000},
        f"키워드 검색 실패 query={query}",
    )


async def kakao_category_search(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    category_group_code: str,
    x: float,
    y: float,
) -> list[dict[str, object]]:
    return await _kakao_paginate(
        client, sem, "category.json",
        {"category_group_code": category_group_code, "x": x, "y": y, "radius": 20000},
        f"카테고리 검색 실패 code={category_group_code}",
    )


def parse_kakao_doc(doc: dict[str, object], default_tags: list[str]) -> PlaceRow | None:
    """카카오 응답 document → places INSERT 파라미터. 좌표 없으면 None."""
    try:
        lng = float(doc["x"])
        lat = float(doc["y"])
    except (KeyError, ValueError, TypeError):
        return None

    name = (doc.get("place_name") or "").strip()[:200]
    if not name:
        return None

    # category_name으로 태그 세분화 (예: "음식점 > 한식 > 삼겹살")
    cat = doc.get("category_name", "")
    if "카페" in cat or "커피" in cat:
        tags = ["#카페"]
    elif "음식점" in cat or "식당" in cat or "맛집" in cat:
        tags = ["#먹방", "#식당"]
    elif "관광" in cat or "명소" in cat or "여행" in cat:
        tags = ["#랜드마크", "#관광명소"]
    elif "문화" in cat or "역사" in cat or "박물관" in cat or "미술관" in cat:
        tags = ["#실내", "#역사"]
    else:
        tags = list(default_tags)

    return {
        "name": name,
        "lng": lng,
        "lat": lat,
        "address": doc.get("road_address_name") or doc.get("address_name") or None,
        "tags": tags,
    }


async def upsert_place(conn: asyncpg.Connection, row: PlaceRow, dry_run: bool) -> str:
    """
    반환값: 'inserted' | 'corrected' | 'skipped'

    1. 반경 150m 내 이름이 유사한 장소 검색
    2. 발견 시:
       a. source='tourapi' + 거리 > 100m → 좌표 UPDATE (교정)
       b. 그 외 → skip
    3. 미발견 → INSERT (source='kakao')
    """
    existing = await conn.fetchrow(
        """
        SELECT id, source,
               ST_Distance(location, ST_MakePoint($1, $2)::geography) AS dist
        FROM places
        WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
          AND name ILIKE $4
        ORDER BY dist
        LIMIT 1
        """,
        row["lng"], row["lat"], float(_DEDUP_RADIUS_M), row["name"],
    )

    if existing:
        if existing["source"] == "tourapi" and existing["dist"] > _COORD_CORRECT_THRESHOLD_M:
            if not dry_run:
                await conn.execute(
                    "UPDATE places SET location = ST_MakePoint($1, $2)::geography WHERE id = $3",
                    row["lng"], row["lat"], existing["id"],
                )
            return "corrected"
        return "skipped"

    if not dry_run:
        await conn.execute(
            """
            INSERT INTO places (name, location, address, category_tags, source)
            VALUES ($1, ST_MakePoint($2, $3)::geography, $4, $5, 'kakao')
            """,
            row["name"], row["lng"], row["lat"], row["address"], row["tags"],
        )
    return "inserted"


async def collect_city(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool | None,
    sem: asyncio.Semaphore,
    city: str,
    lon: float,
    lat: float,
    dry_run: bool,
) -> dict[str, int]:
    docs: list[PlaceRow | None] = []

    # 카테고리 검색
    for code, default_tags in CATEGORY_TAGS.items():
        items = await kakao_category_search(client, sem, code, lon, lat)
        docs.extend(parse_kakao_doc(d, default_tags) for d in items)
        log.info("%s | 카테고리=%s | %d건", city, code, len(items))

    # 키워드 검색
    for tmpl in KEYWORD_TEMPLATES:
        query = tmpl.format(city=city)
        items = await kakao_keyword_search(client, sem, query, lon, lat)
        docs.extend(parse_kakao_doc(d, ["#핫플"]) for d in items)
        log.info("%s | 키워드=%s | %d건", city, query, len(items))

    counts: dict[str, int] = {"inserted": 0, "corrected": 0, "skipped": 0}

    seen: set[tuple[str, float, float]] = set()
    deduped: list[PlaceRow] = []
    for d in docs:
        if d is None:
            continue
        key = (d["name"], d["lng"], d["lat"])
        if key not in seen:
            seen.add(key)
            deduped.append(d)
    total_parsed = len([d for d in docs if d is not None])
    if total_parsed > len(deduped):
        log.info("%s | 메모리 dedup: %d → %d건", city, total_parsed, len(deduped))

    if pool is not None:
        async with pool.acquire() as conn:
            for row in deduped:
                try:
                    result = await upsert_place(conn, row, dry_run)
                    counts[result] += 1
                except Exception as e:
                    log.warning("%s upsert 실패 name=%s: %s", city, row.get("name"), e)
    else:
        # dry-run: DB 미접촉 — 파싱된 장소 수를 inserted로 집계
        counts["inserted"] = len(deduped)

    log.info(
        "✅ %s 완료 | inserted=%d corrected=%d skipped=%d (dry_run=%s)",
        city, counts["inserted"], counts["corrected"], counts["skipped"], dry_run,
    )
    return counts


async def main(target_city: str | None = None, dry_run: bool = False) -> None:
    if not _KAKAO_KEY:
        raise ValueError("KAKAO_REST_API_KEY 환경 변수가 설정되지 않았습니다.")

    # dry-run 시 DB 풀 생성 스킵 — POSTGRES_URL 없어도 실행 가능
    pool: asyncpg.Pool | None = None
    if not dry_run:
        db_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
        pool = await create_pool(db_url)

    # Rate Limit 대비 보수적 동시성 (카카오: 초당 10 QPS 기본)
    sem = asyncio.Semaphore(5)

    cities = (
        {target_city: CITY_CENTERS[target_city]}
        if target_city
        else CITY_CENTERS
    )

    total: dict[str, int] = {"inserted": 0, "corrected": 0, "skipped": 0}

    async with httpx.AsyncClient() as client:
        for city, (lon, lat) in cities.items():
            counts = await collect_city(client, pool, sem, city, lon, lat, dry_run)
            for k in total:
                total[k] += counts[k]

    kakao_count_str = "N/A(dry-run)"
    if pool is not None:
        async with pool.acquire() as conn:
            kakao_count_str = str(await conn.fetchval(
                "SELECT COUNT(*) FROM places WHERE source = 'kakao'"
            ))
        await pool.close()

    log.info(
        "🎉 완료 | inserted=%d corrected=%d skipped=%d | places(kakao) 누적 %s건",
        total["inserted"], total["corrected"], total["skipped"], kakao_count_str,
    )
    if total["inserted"] > 0 and not dry_run:
        log.warning(
            "⚠️  새로 삽입된 %d개 장소의 embedding=NULL 상태입니다. "
            "PgvectorRetriever에서 검색되려면 임베딩 생성이 필요합니다:\n"
            "  cd ai && python -m scripts.generate_embeddings",
            total["inserted"],
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="카카오 로컬 보충 수집기")
    parser.add_argument("--city", help="특정 도시만 수집 (예: 부산)")
    parser.add_argument("--dry-run", action="store_true", help="DB 미접촉 — API 연결 및 파싱만 확인")
    args = parser.parse_args()

    if args.city and args.city not in CITY_CENTERS:
        raise SystemExit(f"지원하지 않는 도시: {args.city}. 지원 도시: {', '.join(CITY_CENTERS)}")

    asyncio.run(main(target_city=args.city, dry_run=args.dry_run))

#!/usr/bin/env python3
"""
TourAPI 배치 수집기
국내 14개 지역(20개 도시 커버) 관광지/식당/문화시설 데이터를 수집해 places 테이블에 저장.
한 번만 실행하는 시드 데이터 수집용 스크립트.

실행: cd ai && python -m scripts.collect_tourapi
"""
import asyncio
import logging
import os
from pathlib import Path

import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BASE_URL = "https://apis.data.go.kr/B551011/KorService2"
SERVICE_KEY = os.environ["TOURAPI_KEY"]

# 수집 대상 지역 (도 단위로 묶어서 20개 도시 커버)
AREAS = {
    "서울": 1, "인천": 2, "대전": 3, "대구": 4, "광주": 5,
    "부산": 6, "울산": 7,
    "경기(수원·가평)": 31, "강원(강릉·춘천·속초)": 32,
    "경북(경주)": 35, "경남(거제·통영·남해)": 36,
    "전북(전주)": 37, "전남(여수·담양)": 38, "제주": 39,
}

# contentTypeId → category_tags 매핑
TYPE_TAGS: dict[str, list[str]] = {
    "12": ["#뷰맛집", "#랜드마크"],
    "14": ["#실내", "#역사"],
    "15": ["#이벤트"],
    "28": ["#액티비티"],
    "38": ["#쇼핑"],
    "39": ["#먹방", "#식당"],
}
CONTENT_TYPES = list(TYPE_TAGS.keys())  # 숙박(32) 제외


async def fetch_page(client: httpx.AsyncClient, area_code: int, ct_id: str, page: int) -> dict:
    r = await client.get(
        f"{BASE_URL}/areaBasedList2",
        params={
            "serviceKey": SERVICE_KEY, "numOfRows": 100, "pageNo": page,
            "MobileOS": "ETC", "MobileApp": "cloumy", "_type": "json",
            "areaCode": area_code, "contentTypeId": ct_id,
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


async def collect_area(client: httpx.AsyncClient, sem: asyncio.Semaphore, area_code: int, ct_id: str) -> list[dict]:
    """한 지역 + contentType의 전체 페이지를 수집해 raw item 리스트 반환."""
    items: list[dict] = []
    page = 1
    while True:
        async with sem:
            try:
                data = await fetch_page(client, area_code, ct_id, page)
            except Exception as e:
                log.warning("요청 실패 area=%s type=%s page=%s: %s", area_code, ct_id, page, e)
                break

        body = data.get("response", {}).get("body", {})
        raw = body.get("items", {})
        if not raw:
            break
        item_list = raw.get("item", [])
        if not item_list:
            break
        if isinstance(item_list, dict):  # 결과 1건이면 dict로 오는 TourAPI 버그
            item_list = [item_list]

        items.extend(item_list)

        if page * 100 >= int(body.get("totalCount", 0)):
            break
        page += 1

    return items


def parse_row(item: dict) -> dict | None:
    """TourAPI item → places INSERT 파라미터. 좌표 없으면 None 반환."""
    try:
        lng = float(item.get("mapx") or 0)
        lat = float(item.get("mapy") or 0)
        if lng == 0 or lat == 0:
            return None
    except (ValueError, TypeError):
        return None

    ct_id = str(item.get("contenttypeid", ""))
    return {
        "name": (item.get("title") or "").strip()[:200],
        "lng": lng, "lat": lat,
        "address": (item.get("addr1") or "").strip() or None,
        "tags": TYPE_TAGS.get(ct_id, []),
    }


async def insert_places(pool: asyncpg.Pool, rows: list[dict]) -> int:
    """유효한 행을 places에 삽입한다.
    유니크 제약이 없으므로(마이그레이션 범위 밖), 이름 일치 + 30m 반경 내
    기존 장소가 있으면 스킵해 재실행 시 중복 누적을 막는다.
    """
    valid = [r for r in rows if r and r["name"]]
    if not valid:
        return 0
    inserted = 0
    async with pool.acquire() as conn:
        for r in valid:
            exists = await conn.fetchval(
                """
                SELECT EXISTS(
                    SELECT 1 FROM places
                    WHERE name = $1
                      AND ST_DWithin(location, ST_MakePoint($2, $3)::geography, 30)
                )
                """,
                r["name"], r["lng"], r["lat"],
            )
            if exists:
                continue
            await conn.execute(
                """
                INSERT INTO places (name, location, address, category_tags, source)
                VALUES ($1, ST_MakePoint($2, $3)::geography, $4, $5, 'tourapi')
                """,
                r["name"], r["lng"], r["lat"], r["address"], r["tags"],
            )
            inserted += 1
    return inserted


async def main() -> None:
    db_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
    pool = await asyncpg.create_pool(db_url, min_size=2, max_size=5, command_timeout=10)
    sem = asyncio.Semaphore(10)
    total = 0

    async with httpx.AsyncClient() as client:
        for city, area_code in AREAS.items():
            rows: list[dict] = []
            for ct_id in CONTENT_TYPES:
                items = await collect_area(client, sem, area_code, ct_id)
                rows.extend(filter(None, (parse_row(i) for i in items)))
                log.info("%s | type=%s | %d건 파싱", city, ct_id, len(items))

            n = await insert_places(pool, rows)
            total += n
            log.info("✅ %s 완료 — %d건 저장", city, n)

    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM places WHERE source = 'tourapi'")
    await pool.close()
    log.info("🎉 완료 | 이번 실행 %d건 삽입 | places(tourapi) 누적 %d건", total, count)


if __name__ == "__main__":
    asyncio.run(main())

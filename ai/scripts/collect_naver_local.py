#!/usr/bin/env python3
"""
네이버 지역검색 API 보충 수집기 (시험 실행용)
TourAPI+카카오가 도시 단위 넓은 검색이라 서로 겹쳐 신규 삽입이 거의 없었던 문제
(2026-07 발견, planning/unimplemented.md)를 피하려고, 동네 단위로 좁힌 키워드로
검색한다. 네이버 지역검색 API는 좌표/반경 파라미터가 없어서(카카오와 다름) 검색어
텍스트 자체에 동네명을 넣어야 지역이 좁혀진다 — 그래서 도시 전체가 아니라
AREAS에 정의된 동네 단위로만 우선 시험한다.

이 스크립트는 "구현하면 무조건 성공"이 아니라 "시험해서 순증 건수를 확인"하는
용도다 — 카카오처럼 다 겹쳐서 순증 0건이면 그 자체가 유의미한 결과다.
AREAS의 동네 목록은 완전한 행정동 전수 조사가 아니라 시험용 샘플이다
(잘 되면 전체 행정동으로 확장 검토).

실행:
  cd ai && python -m scripts.collect_naver_local --city 전주 --dry-run
  cd ai && python -m scripts.collect_naver_local --city 전주
  cd ai && python -m scripts.collect_naver_local --city 경주
"""
import argparse
import asyncio
import logging
import os
import re
from pathlib import Path
from typing import TypedDict

import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from app.config.database import create_pool  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_CLIENT_ID = os.environ.get("NAVER_SEARCH_CLIENT_ID", "")
_CLIENT_SECRET = os.environ.get("NAVER_SEARCH_CLIENT_SECRET", "")
_BASE_URL = "https://openapi.naver.com/v1/search/local.json"

# 네이버 지역검색 mapx/mapy는 WGS84 경도/위도 * 10^7 (실측 검증 완료 — 해운대해수욕장
# mapx=1291583542, mapy=351581445 → /1e7 하면 실제 좌표(129.16, 35.16)와 일치)
_COORD_SCALE = 10_000_000

# 수집 대상 동네 — 완전한 행정동 전수 목록이 아니라 잘 알려진 동네명 샘플
# (전주/경주 시험에서 도시 단위 검색 대비 순증 효과 확인됨 — 2026-07-05, 179건)
AREAS: dict[str, list[str]] = {
    "전주": ["전주 한옥마을", "전주 삼천동", "전주 효자동", "전주 서신동", "전주 평화동"],
    "경주": ["경주 황리단길", "경주 보문단지", "경주 성건동", "경주 안강읍", "경주 불국사"],
    "서울": ["서울 홍대", "서울 연남동", "서울 성수동", "서울 이태원", "서울 가로수길"],
    "부산": ["부산 서면", "부산 전포동", "부산 광안리", "부산 남포동", "부산 해운대"],
    "제주": ["제주 애월", "제주 성산", "제주 서귀포", "제주 조천", "제주 협재"],
    "강릉": ["강릉 안목해변", "강릉 경포", "강릉 주문진", "강릉 명주동", "강릉 강문"],
    "여수": ["여수 낭만포차거리", "여수 돌산", "여수 오동도", "여수 웅천", "여수 중앙동"],
    "인천": ["인천 송도", "인천 개항장거리", "인천 구월동", "인천 부평", "인천 차이나타운"],
    "대전": ["대전 은행동", "대전 둔산동", "대전 유성", "대전 대흥동", "대전 관저동"],
    "대구": ["대구 동성로", "대구 수성못", "대구 김광석길", "대구 앞산", "대구 봉산문화거리"],
    "광주": ["광주 충장로", "광주 상무지구", "광주 동명동", "광주 양림동", "광주 첨단"],
    "속초": ["속초 중앙시장", "속초 영랑호", "속초 아바이마을", "속초 대포항", "속초 청호동"],
    "춘천": ["춘천 명동거리", "춘천 소양강", "춘천 공지천", "춘천 삼악산", "춘천 강촌"],
    "거제": ["거제 고현동", "거제 장승포", "거제 학동", "거제 지세포", "거제 능포"],
}

KEYWORD_TEMPLATES = ["{area} 맛집", "{area} 카페", "{area} 로컬 맛집", "{area} 노포", "{area} 술집"]

# 카테고리 문자열(category_name) → places.category_tags 매핑 — collect_kakao.py와 동일 기준
_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("카페", ["#카페"]),
    ("커피", ["#카페"]),
    ("음식점", ["#먹방", "#식당"]),
    ("술집", ["#먹방", "#식당"]),
    ("관광", ["#랜드마크", "#관광명소"]),
    ("명소", ["#랜드마크", "#관광명소"]),
    ("문화", ["#실내", "#역사"]),
    ("역사", ["#실내", "#역사"]),
]
_DEFAULT_TAGS = ["#핫플"]

_DEDUP_RADIUS_M = 150
_COORD_CORRECT_THRESHOLD_M = 100

_HTML_TAG_RE = re.compile(r"<[^>]+>")


class PlaceRow(TypedDict):
    name: str
    lng: float
    lat: float
    address: str | None
    tags: list[str]


def _strip_html(text: str) -> str:
    return _HTML_TAG_RE.sub("", text)


def _tags_for_category(category_name: str) -> list[str]:
    for keyword, tags in _CATEGORY_RULES:
        if keyword in category_name:
            return tags
    return list(_DEFAULT_TAGS)


async def naver_local_search(client: httpx.AsyncClient, query: str) -> list[dict]:
    """네이버 지역검색 — 쿼리당 최대 5건, 페이지네이션 없음(start 파라미터가 사실상 무의미).
    QPS 제한이 꽤 엄격해서(딜레이 없이 연속 호출 시 429 발생 확인됨) 429 시 1초 대기 후 1회 재시도.
    """
    headers = {
        "X-Naver-Client-Id": _CLIENT_ID,
        "X-Naver-Client-Secret": _CLIENT_SECRET,
    }
    params = {"query": query, "display": 5}
    r = await client.get(_BASE_URL, headers=headers, params=params, timeout=10)
    if r.status_code == 429:
        await asyncio.sleep(1)
        r = await client.get(_BASE_URL, headers=headers, params=params, timeout=10)
    r.raise_for_status()
    return r.json().get("items", [])


def parse_item(item: dict) -> PlaceRow | None:
    try:
        lng = float(item["mapx"]) / _COORD_SCALE
        lat = float(item["mapy"]) / _COORD_SCALE
    except (KeyError, ValueError, TypeError):
        return None
    if lng == 0 or lat == 0:
        return None

    name = _strip_html(item.get("title") or "").strip()[:200]
    if not name:
        return None

    address = _strip_html(item.get("roadAddress") or item.get("address") or "").strip() or None
    tags = _tags_for_category(item.get("category", ""))

    return {"name": name, "lng": lng, "lat": lat, "address": address, "tags": tags}


async def upsert_place(conn: asyncpg.Connection, row: PlaceRow, dry_run: bool) -> str:
    """collect_kakao.py의 upsert_place와 동일한 dedup 규칙(150m+이름 유사) — source만 'naver'.
    반환값: 'inserted' | 'corrected' | 'skipped'
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
            VALUES ($1, ST_MakePoint($2, $3)::geography, $4, $5, 'naver')
            """,
            row["name"], row["lng"], row["lat"], row["address"], row["tags"],
        )
    return "inserted"


async def collect_city(
    client: httpx.AsyncClient, pool: asyncpg.Pool | None, city: str, dry_run: bool,
) -> dict[str, int]:
    areas = AREAS[city]
    docs: list[PlaceRow | None] = []

    for area in areas:
        for tmpl in KEYWORD_TEMPLATES:
            query = tmpl.format(area=area)
            try:
                items = await naver_local_search(client, query)
            except Exception as e:
                log.warning("검색 실패 query=%s: %s", query, e)
                continue
            docs.extend(parse_item(i) for i in items)
            log.info("%s | %s | %d건", city, query, len(items))
            await asyncio.sleep(0.2)  # QPS 제한 대비 요청 간 간격

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

    counts: dict[str, int] = {"inserted": 0, "corrected": 0, "skipped": 0}

    if pool is not None:
        async with pool.acquire() as conn:
            for row in deduped:
                try:
                    result = await upsert_place(conn, row, dry_run)
                    counts[result] += 1
                except Exception as e:
                    log.warning("%s upsert 실패 name=%s: %s", city, row.get("name"), e)
    else:
        counts["inserted"] = len(deduped)

    log.info(
        "✅ %s 완료 | inserted=%d corrected=%d skipped=%d (dry_run=%s)",
        city, counts["inserted"], counts["corrected"], counts["skipped"], dry_run,
    )
    return counts


async def main(target_cities: list[str], dry_run: bool = False) -> None:
    if not _CLIENT_ID or not _CLIENT_SECRET:
        raise ValueError("NAVER_SEARCH_CLIENT_ID/SECRET 환경 변수가 설정되지 않았습니다.")

    pool: asyncpg.Pool | None = None
    if not dry_run:
        db_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
        pool = await create_pool(db_url)

    total: dict[str, int] = {"inserted": 0, "corrected": 0, "skipped": 0}
    async with httpx.AsyncClient() as client:
        for city in target_cities:
            counts = await collect_city(client, pool, city, dry_run)
            for k in total:
                total[k] += counts[k]

    naver_count_str = "N/A(dry-run)"
    if pool is not None:
        async with pool.acquire() as conn:
            naver_count_str = str(await conn.fetchval(
                "SELECT COUNT(*) FROM places WHERE source = 'naver'"
            ))
        await pool.close()

    log.info(
        "🎉 전체 완료 | inserted=%d corrected=%d skipped=%d | places(naver) 누적 %s건",
        total["inserted"], total["corrected"], total["skipped"], naver_count_str,
    )
    if total["inserted"] == 0 and not dry_run:
        log.warning(
            "⚠️  순증 0건 — 카카오와 동일한 결과입니다. 동네 키워드를 더 세분화하거나 "
            "다른 소스(Google Places 등)를 검토해야 할 수 있습니다."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="네이버 지역검색 API 보충 수집기")
    parser.add_argument("--city", choices=list(AREAS.keys()), help="특정 도시만 수집")
    parser.add_argument("--all", action="store_true", help="AREAS에 정의된 전체 도시 수집")
    parser.add_argument("--dry-run", action="store_true", help="DB 미접촉 — API 연결 및 파싱만 확인")
    args = parser.parse_args()

    if not args.city and not args.all:
        raise SystemExit("--city 또는 --all 중 하나는 지정해야 합니다.")

    cities = list(AREAS.keys()) if args.all else [args.city]
    asyncio.run(main(target_cities=cities, dry_run=args.dry_run))

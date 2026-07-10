#!/usr/bin/env python3
"""
장소 데이터 다국어 배치 번역기
큐레이션 places(name/address)를 영어/일본어/중국어간체/중국어번체로 번역해
name_en/name_ja/name_zh_hans/name_zh_hant, address_en/address_ja/address_zh_hans/address_zh_hant
컬럼에 저장한다. 관광지·역·주요 시설(랜드마크/관광명소/역사 태그)부터 우선 처리.

실행:
  cd ai && python -m scripts.translate_places
  cd ai && python -m scripts.translate_places --dry-run
  cd ai && python -m scripts.translate_places --limit 20

재실행: name_en IS NULL 행만 조회하므로 중간 실패 후 재실행 안전.
"""
import argparse
import asyncio
import json
import logging
import os
from pathlib import Path

import asyncpg
from anthropic import AsyncAnthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

HAIKU_MODEL = "claude-haiku-4-5-20251001"
CHUNK_SIZE = 20
CONCURRENCY = 5

# 관광지·역·주요 시설부터 우선 처리 (collect_kakao.py CATEGORY_TAGS와 동일 어휘)
PRIORITY_TAGS = ["#랜드마크", "#관광명소", "#실내", "#역사"]

TRANSLATE_FIELDS = [
    "name_en", "name_ja", "name_zh_hans", "name_zh_hant",
    "address_en", "address_ja", "address_zh_hans", "address_zh_hant",
]

BATCH_SYSTEM_PROMPT = """당신은 한국 지명·주소 번역 전문가입니다. 아래 장소 목록 각각을 영어, 일본어, \
중국어간체, 중국어번체로 번역합니다.

출력 형식: JSON 배열 하나만 출력합니다. 다른 텍스트 없음.
[
  {"index": 1, "name_en": "...", "name_ja": "...", "name_zh_hans": "...", "name_zh_hant": "...",
   "address_en": "...", "address_ja": "...", "address_zh_hans": "...", "address_zh_hant": "..."},
  ...
]

규칙:
- index는 입력 목록 각 줄 맨 앞 [N] 번호와 정확히 일치해야 함
- 고유명사(장소명)는 표준 로마자 표기/가나 음역/병음 음역을 우선하되, 널리 알려진 의역이 있으면 그것을 사용
- 일반명사(역/시장/공원/거리 등)는 의미를 살려 번역
- 입력의 address가 "(없음)"이면 해당 항목의 address_en/ja/zh_hans/zh_hant는 전부 null
- 입력 전체 항목에 대해 빠짐없이 작성
- JSON 외 텍스트 절대 금지"""


def _parse_chunk_response(raw: str, chunk: list[asyncpg.Record]) -> list[tuple]:
    """반환값: executemany용 (name_en, ..., address_zh_hant, id) 튜플 리스트."""
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    data = json.loads(raw)

    rows: list[tuple] = []
    for item in data:
        idx = item.get("index")
        if not isinstance(idx, int) or not (1 <= idx <= len(chunk)):
            log.warning("환각 감지 — 잘못된 index: %s", idx)
            continue
        record = chunk[idx - 1]
        values = tuple(item.get(f) for f in TRANSLATE_FIELDS)
        rows.append(values + (record["id"],))
    return rows


async def translate_chunk(
    client: AsyncAnthropic, sem: asyncio.Semaphore, chunk: list[asyncpg.Record]
) -> list[tuple]:
    items_text = "\n".join(
        f"[{i + 1}] name={r['name']} address={r['address'] or '(없음)'}"
        for i, r in enumerate(chunk)
    )
    async with sem:
        try:
            response = await client.messages.create(
                model=HAIKU_MODEL,
                max_tokens=4096,
                system=BATCH_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": items_text}],
            )
        except Exception as e:
            log.warning("Haiku 호출 실패 (청크 스킵, 다음 실행에 재시도): %s", e)
            return []

    try:
        return _parse_chunk_response(response.content[0].text.strip(), chunk)
    except Exception as e:
        log.warning("청크 파싱 실패 (스킵, 다음 실행에 재시도): %s", e)
        return []


async def main(dry_run: bool, limit: int | None) -> None:
    anthropic_key = os.environ["ANTHROPIC_API_KEY"]
    postgres_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")

    client = AsyncAnthropic(api_key=anthropic_key)
    pool = await asyncpg.create_pool(postgres_url, min_size=2, max_size=5)

    try:
        query = """
            SELECT id, name, address
            FROM places
            WHERE name_en IS NULL
            ORDER BY (category_tags && $1::text[]) DESC
        """
        params: list = [PRIORITY_TAGS]
        if limit is not None:
            query += " LIMIT $2"
            params.append(limit)

        rows = await pool.fetch(query, *params)
        total = len(rows)
        log.info("번역 대상: %d건 (dry_run=%s)", total, dry_run)
        if total == 0:
            log.info("모든 장소가 이미 번역되어 있습니다.")
            return

        sem = asyncio.Semaphore(CONCURRENCY)
        chunks = [rows[i : i + CHUNK_SIZE] for i in range(0, len(rows), CHUNK_SIZE)]

        tasks = [translate_chunk(client, sem, chunk) for chunk in chunks]
        results = await asyncio.gather(*tasks)

        all_updates: list[tuple] = [row for chunk_rows in results for row in chunk_rows]
        log.info("파싱 성공: %d / %d건", len(all_updates), total)

        if dry_run:
            log.info("dry-run — DB 미반영. 샘플: %s", all_updates[:3])
            return

        if all_updates:
            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    UPDATE places SET
                        name_en = $1, name_ja = $2, name_zh_hans = $3, name_zh_hant = $4,
                        address_en = $5, address_ja = $6, address_zh_hans = $7, address_zh_hant = $8
                    WHERE id = $9::uuid
                    """,
                    all_updates,
                )
            log.info("DB 저장 완료: %d건", len(all_updates))

        remaining = await pool.fetchval("SELECT COUNT(*) FROM places WHERE name_en IS NULL")
        log.info("🎉 완료 | 이번 실행 %d건 저장 | 남은 미번역 %d건", len(all_updates), remaining)
        if remaining and remaining > 0:
            log.info("남은 항목은 python -m scripts.translate_places 재실행으로 이어서 처리 가능")

    finally:
        await pool.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="장소 데이터 다국어 배치 번역기")
    parser.add_argument("--dry-run", action="store_true", help="DB 미반영 — 파싱 결과만 확인")
    parser.add_argument("--limit", type=int, help="처리할 최대 건수 (테스트용)")
    args = parser.parse_args()

    asyncio.run(main(dry_run=args.dry_run, limit=args.limit))

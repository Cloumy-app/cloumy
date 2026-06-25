#!/usr/bin/env python3
"""
OpenAI 임베딩 배치 생성 스크립트
places 테이블 전체 행에 text-embedding-3-small(1536차원) 임베딩을 생성해
embedding 컬럼에 저장한다. OpenAI Batch API 사용으로 개별 호출 대비 50% 저렴.

실행: cd ai && python -m scripts.generate_embeddings
재실행: embedding IS NULL 행만 조회하므로 중간 실패 후 재실행 안전.
"""
import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

BATCH_ID_FILE = Path("/tmp/embeddings_batch_id.txt")  # 재시작 시 기존 배치 재사용

import asyncpg
from dotenv import load_dotenv
from openai import AsyncOpenAI
from pgvector.asyncpg import register_vector

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
DB_CHUNK_SIZE = 1000  # executemany 청크 크기 (메모리 안전)


async def _init_conn(conn: asyncpg.Connection) -> None:
    # pgvector 'vector' 타입 코덱 등록 — 미등록 시 embedding 컬럼 UPDATE 실패
    await register_vector(conn)


def _build_embed_text(name: str, address: str | None, category_tags: list[str] | None) -> str:
    # #먹방 → 먹방 으로 정규화 (임베딩 검색 일관성)
    tags = " ".join(t.lstrip("#") for t in (category_tags or []))
    return f"{name} {address or ''} {tags}".strip()


async def main() -> None:
    openai_key = os.environ["OPENAI_API_KEY"]
    postgres_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")

    client = AsyncOpenAI(api_key=openai_key)
    pool = await asyncpg.create_pool(postgres_url, min_size=2, max_size=5, init=_init_conn)
    input_path: str | None = None

    try:
        # 1. embedding IS NULL 행 조회
        rows = await pool.fetch(
            "SELECT id, name, address, category_tags FROM places WHERE embedding IS NULL"
        )
        total = len(rows)
        log.info("임베딩 미생성 장소: %d건", total)
        if total == 0:
            log.info("모든 장소에 임베딩이 이미 존재합니다.")
            return

        # 2. Batch 입력 JSONL 생성
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
        ) as f:
            input_path = f.name
            for row in rows:
                line = {
                    "custom_id": str(row["id"]),
                    "method": "POST",
                    "url": "/v1/embeddings",
                    "body": {
                        "model": EMBED_MODEL,
                        "input": _build_embed_text(
                            row["name"], row["address"], row["category_tags"]
                        ),
                    },
                }
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        log.info("입력 JSONL 생성: %s (%d줄)", input_path, total)

        # 3. 파일 업로드
        with open(input_path, "rb") as f:
            upload = await client.files.create(file=f, purpose="batch")
        log.info("업로드 완료: file_id=%s", upload.id)

        # 4. 배치 생성 (이미 생성된 배치 ID가 있으면 재사용)
        if BATCH_ID_FILE.exists():
            saved_id = BATCH_ID_FILE.read_text().strip()
            log.info("기존 배치 재사용: %s", saved_id)
            batch = await client.batches.retrieve(saved_id)
        else:
            batch = await client.batches.create(
                input_file_id=upload.id,
                endpoint="/v1/embeddings",
                completion_window="24h",
            )
            BATCH_ID_FILE.write_text(batch.id)
            log.info("배치 생성: batch_id=%s status=%s", batch.id, batch.status)

        # 5. 폴링 (60초 간격, 네트워크 오류 시 최대 3회 재시도)
        while batch.status not in ("completed", "failed", "expired", "cancelled"):
            log.info("배치 처리 중: %s — 60초 후 재확인...", batch.status)
            await asyncio.sleep(60)
            for attempt in range(3):
                try:
                    batch = await client.batches.retrieve(batch.id)
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    log.warning("폴링 오류 (재시도 %d/3): %s", attempt + 1, e)
                    await asyncio.sleep(10)
            log.info(
                "  request_counts: total=%s completed=%s failed=%s",
                batch.request_counts.total if batch.request_counts else "?",
                batch.request_counts.completed if batch.request_counts else "?",
                batch.request_counts.failed if batch.request_counts else "?",
            )

        if batch.status != "completed":
            log.error("배치 실패: status=%s", batch.status)
            if batch.error_file_id:
                err_content = await client.files.content(batch.error_file_id)
                log.error("에러 내용 (첫 2000자):\n%s", err_content.text[:2000])
            return

        log.info("배치 완료!")

        # 6. 결과 다운로드 + 파싱
        output = await client.files.content(batch.output_file_id)
        results: dict[str, list[float]] = {}
        failed_ids: list[str] = []
        for line in output.text.splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)
            if obj["response"]["status_code"] != 200:
                log.warning("개별 실패: custom_id=%s", obj["custom_id"])
                failed_ids.append(obj["custom_id"])
                continue
            results[obj["custom_id"]] = obj["response"]["body"]["data"][0]["embedding"]

        log.info("파싱 완료: 성공 %d건, 실패 %d건", len(results), len(failed_ids))
        if failed_ids:
            log.warning("실패 ID 목록: %s", failed_ids[:20])

        # 7. DB 업데이트 (1,000건 청크)
        pairs = list(results.items())
        updated = 0
        async with pool.acquire() as conn:
            for i in range(0, len(pairs), DB_CHUNK_SIZE):
                chunk = pairs[i : i + DB_CHUNK_SIZE]
                await conn.executemany(
                    "UPDATE places SET embedding = $1 WHERE id = $2::uuid",
                    [(vec, uid) for uid, vec in chunk],
                )
                updated += len(chunk)
                log.info("UPDATE 진행: %d / %d", updated, len(pairs))

        log.info("임베딩 저장 완료: %d건", updated)

        # 8. 미완료 확인
        remaining = await pool.fetchval("SELECT COUNT(*) FROM places WHERE embedding IS NULL")
        if remaining and remaining > 0:
            log.warning("여전히 임베딩 없는 장소: %d건 → python -m scripts.generate_embeddings 재실행", remaining)
        else:
            log.info("모든 장소 임베딩 완료!")
        BATCH_ID_FILE.unlink(missing_ok=True)

    finally:
        await pool.close()
        if input_path:
            Path(input_path).unlink(missing_ok=True)
            log.info("임시 파일 정리 완료")


if __name__ == "__main__":
    asyncio.run(main())

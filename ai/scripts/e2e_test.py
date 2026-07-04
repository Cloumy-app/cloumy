#!/usr/bin/env python3
"""
AI 루트 생성 통합 테스트 E2E
Mock 없이 실제 서비스(DB, Redis, Claude API, Spring, FastAPI)로 전체 흐름 검증.
CI에는 포함하지 않음 — 실제 Claude API를 호출하므로 실행마다 비용 발생.

사전 조건:
  1. docker-compose up -d          (Postgres, Redis)
  2. cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
  3. cd ai && uvicorn app.main:app --port 8000

실행:
  cd ai && python -m scripts.e2e_test
  cd ai && python -m scripts.e2e_test --spring-url http://localhost:8080
"""
import argparse
import asyncio
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from app.config.database import create_pool  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

SPRING_URL = os.environ.get("SPRING_URL", "http://localhost:8080")
FASTAPI_URL = os.environ.get("FASTAPI_URL", "http://localhost:8000")

# 두 시나리오 사이에 두는 대기 — RateLimitFilter(1분 3회) 카운터가 완전히 비워질 시간
_RATE_LIMIT_WINDOW_WAIT_S = 65


@dataclass
class DevAuth:
    token: str
    user_id: str


@dataclass
class RouteStreamResult:
    route_id: str | None
    day_summaries: dict[int, str] = field(default_factory=dict)
    slots: list[dict[str, Any]] = field(default_factory=list)
    done_received: bool = False
    elapsed_s: float = 0.0
    raw_lines: list[str] = field(default_factory=list)


@dataclass
class ScenarioResult:
    name: str
    passed: bool
    duration_s: float
    detail: str


# --- 인증 ---

async def get_dev_token(client: httpx.AsyncClient) -> DevAuth:
    resp = await client.post(f"{SPRING_URL}/v1/dev/token")
    resp.raise_for_status()
    data = resp.json()["data"]
    return DevAuth(token=data["accessToken"], user_id=data["user"]["id"])


async def restore_dev_pass(client: httpx.AsyncClient) -> None:
    """/v1/dev/token 재호출 = grantDayPass() 재실행 — 패스 복구용 단일 진입점."""
    await get_dev_token(client)


# --- SSE 파싱 (event:/data: 두 줄 조합 + 빈 줄 구분만 쓰므로 최소 구현으로 충분) ---

async def collect_route_stream(
    client: httpx.AsyncClient, token: str, body: dict[str, Any], timeout: float = 60.0,
) -> RouteStreamResult:
    t0 = time.monotonic()
    route_id: str | None = None
    day_summaries: dict[int, str] = {}
    slots: list[dict[str, Any]] = []
    done = False
    raw_lines: list[str] = []
    pending_event: str | None = None

    async with client.stream(
        "POST", f"{SPRING_URL}/v1/routes/generate",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    ) as response:
        if response.status_code >= 400:
            error_body = (await response.aread()).decode()
            raise AssertionError(
                f"SSE 대신 에러 응답: status={response.status_code} body={error_body}"
            )
        async for raw in response.aiter_lines():
            raw_lines.append(raw)
            if raw == "":
                pending_event = None
                continue
            if raw.startswith("event:"):
                pending_event = raw[len("event:"):].strip()
                continue
            if not raw.startswith("data:"):
                continue
            data = raw[len("data:"):].lstrip()

            if pending_event == "route_id":
                route_id = data
                pending_event = None
                continue

            obj = json.loads(data)
            if obj.get("done") is True:
                done = True
                break
            if obj.get("type") == "day_summary":
                day_summaries[obj["day"]] = obj["summary"]
            else:
                slots.append(obj)

    return RouteStreamResult(
        route_id=route_id, day_summaries=day_summaries, slots=slots,
        done_received=done, elapsed_s=time.monotonic() - t0, raw_lines=raw_lines,
    )


async def post_plain(client: httpx.AsyncClient, token: str, body: dict[str, Any]) -> httpx.Response:
    """402/429처럼 SSE가 아니라 일반 JSON 에러로 끝나는 요청용 — 스트리밍 불필요."""
    return await client.post(
        f"{SPRING_URL}/v1/routes/generate",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15.0,
    )


# --- 테스트 데이터 ---

def build_standard_body() -> dict[str, Any]:
    start = date.today() + timedelta(days=30)
    end = start + timedelta(days=2)  # 2박 3일
    return {
        "destination": "부산",
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "groupType": "couple",
        "budgetLevel": "mid",
        "tags": ["먹방"],
    }


def build_fallback_variant_body() -> dict[str, Any]:
    # 표준과 destination/nights는 같게(유사 루트 매칭 조건), groupType/budgetLevel만 바꿔 캐시 우회
    body = build_standard_body()
    body["groupType"] = "friends"
    body["budgetLevel"] = "budget"
    return body


# --- DB 검증 ---

async def verify_route_in_db(pool: asyncpg.Pool, route_id: str, expected: dict[str, Any]) -> None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT destination, nights, group_type, budget_level FROM routes WHERE id = $1::uuid",
            route_id,
        )
        assert row is not None, f"routes에 route_id={route_id} 없음 — createRoute() 저장 실패 의심"
        for key in ("destination", "nights", "group_type", "budget_level"):
            assert row[key] == expected[key], (
                f"routes.{key} 불일치: 기대={expected[key]!r} 실제={row[key]!r} (route_id={route_id})"
            )
        slot_count = await conn.fetchval(
            "SELECT COUNT(*) FROM route_slots WHERE route_id = $1::uuid", route_id,
        )
        assert slot_count > 0, f"route_slots 0건 (route_id={route_id}) — 슬롯 저장 실패 의심"


# --- 시나리오 ---

async def scenario_standard(
    client: httpx.AsyncClient, pool: asyncpg.Pool, dev: DevAuth, ctx: dict[str, Any],
) -> str:
    body = build_standard_body()
    ctx["standard_body"] = body

    result = await collect_route_stream(client, dev.token, body, timeout=60.0)

    assert result.route_id is not None, (
        f"route_id 이벤트를 못 받음. 수신 라인 앞부분: {result.raw_lines[:5]}"
    )
    uuid.UUID(result.route_id)  # 형식이 아니면 ValueError로 실패

    nights = 2
    expected_days = set(range(1, nights + 2))  # {1,2,3}
    days_in_order = list(result.day_summaries.keys())
    assert days_in_order == sorted(days_in_order), (
        f"day_summary가 순서대로 안 옴. 수신 순서={days_in_order}"
    )
    assert set(result.day_summaries) == expected_days, (
        f"Day summary 범위 불일치. 기대={sorted(expected_days)}, 실제={sorted(result.day_summaries)}"
    )

    slots_by_day: dict[int, list[dict]] = defaultdict(list)
    for s in result.slots:
        assert s.get("place_id"), f"슬롯에 place_id 없음: {s}"
        slots_by_day[s["day"]].append(s)
    for day in expected_days:
        assert slots_by_day.get(day), f"Day {day}에 슬롯이 없음. 전체 슬롯 수={len(result.slots)}"

    assert result.done_received, "스트림이 done:true 없이 종료됨"

    if result.elapsed_s > 10.0:
        log.warning(
            "표준 루트 생성 %.1fs — 목표(10s) 초과. Claude 응답시간 변동은 하드 실패로 안 봄",
            result.elapsed_s,
        )

    ctx["created_route_ids"].append(result.route_id)
    ctx["route_id"] = result.route_id

    await verify_route_in_db(pool, result.route_id, {
        "destination": "부산", "nights": nights, "group_type": "couple", "budget_level": "mid",
    })

    return (
        f"route_id={result.route_id} elapsed={result.elapsed_s:.2f}s "
        f"days={sorted(result.day_summaries)} slots={len(result.slots)}"
    )


async def scenario_cache_hit(
    client: httpx.AsyncClient, pool: asyncpg.Pool, dev: DevAuth, ctx: dict[str, Any],
) -> str:
    body = ctx["standard_body"]  # 완전히 동일한 바디로 재요청해야 캐시 키가 일치함
    result = await collect_route_stream(client, dev.token, body, timeout=15.0)

    assert result.route_id is not None, "캐시 히트 재요청인데 route_id 이벤트가 안 옴"
    assert result.route_id != ctx["route_id"], (
        "createRoute()가 캐시 체크보다 먼저 실행돼 매번 새 route가 생기는 게 정상인데 "
        f"표준 시나리오와 route_id가 동일함({result.route_id})"
    )
    assert result.done_received, "캐시 히트 스트림이 done:true 없이 종료됨"
    assert result.elapsed_s <= 1.0, (
        f"캐시 히트 응답이 1초를 초과함: {result.elapsed_s:.2f}s — "
        "Spring cacheKey()와 FastAPI _cache_key()가 다른 키를 만들었을 가능성 확인 필요"
    )

    ctx["created_route_ids"].append(result.route_id)
    await verify_route_in_db(pool, result.route_id, {
        "destination": "부산", "nights": 2, "group_type": "couple", "budget_level": "mid",
    })

    return f"route_id={result.route_id}(신규) elapsed={result.elapsed_s:.2f}s (<=1s)"


async def _fastapi_is_up(client: httpx.AsyncClient) -> bool:
    try:
        r = await client.get(f"{FASTAPI_URL}/health", timeout=2.0)
        return r.status_code == 200
    except httpx.TransportError:
        return False


async def scenario_fallback(
    client: httpx.AsyncClient, pool: asyncpg.Pool, dev: DevAuth, ctx: dict[str, Any],
) -> str:
    base_route_id = ctx["route_id"]
    async with pool.acquire() as conn:
        await conn.execute("UPDATE routes SET is_public = true WHERE id = $1::uuid", base_route_id)

    variant_body = build_fallback_variant_body()

    while await _fastapi_is_up(client):
        input(
            f"\n[폴백 시나리오] 로컬 FastAPI(uvicorn, {FASTAPI_URL})를 Ctrl+C로 중지한 뒤 Enter: ",
        )

    try:
        result = await collect_route_stream(client, dev.token, variant_body, timeout=30.0)
        assert result.route_id is not None, "폴백 시나리오인데 route_id 이벤트가 안 옴"
        assert result.done_received, (
            "폴백 스트림이 done:true 없이 종료됨 — is_public 루트가 findSimilarRoutes 조건에 "
            "안 맞았거나(destination/nights±1/tags 겹침), 정말 FastAPI가 다운되지 않았을 수 있음"
        )
        fallback_slots = [s for s in result.slots if s.get("is_fallback") is True]
        assert fallback_slots, (
            f"is_fallback:true 슬롯이 없음 — 유사 루트를 못 찾은 것으로 보임. "
            f"수신 슬롯 일부: {result.slots[:3]}"
        )
        ctx["created_route_ids"].append(result.route_id)
        detail = f"route_id={result.route_id} fallback_slots={len(fallback_slots)}"
    finally:
        for attempt in range(15):
            if await _fastapi_is_up(client):
                log.info("FastAPI 정상 복구 확인됨.")
                break
            input(
                f"[정리] FastAPI를 재시작하세요 (uvicorn app.main:app --port 8000). "
                f"Enter (시도 {attempt + 1}/15): ",
            )
        else:
            log.warning("FastAPI 복구를 자동으로 확인하지 못함 — 수동으로 확인 필요")

    return detail


def scenario_hallucination_skip() -> str:
    return (
        "실제 Claude API로는 특정 place_id 환각을 결정론적으로 재현 불가능 — "
        "ai/tests/test_route_service.py::test_stream_route_hallucination_replacement_respects_day_region"
        "(mock 기반)로 이미 커버됨. 스킵."
    )


async def scenario_pass_required(client: httpx.AsyncClient, pool: asyncpg.Pool, dev: DevAuth) -> str:
    async with pool.acquire() as conn:
        await conn.execute("UPDATE users SET pass_type = 'none' WHERE id = $1::uuid", dev.user_id)
    try:
        body = build_standard_body()
        # 캐시 히트로 새지 않도록 날짜를 표준 시나리오와 구분
        start = date.today() + timedelta(days=40)
        body["startDate"] = start.isoformat()
        body["endDate"] = (start + timedelta(days=2)).isoformat()

        resp = await post_plain(client, dev.token, body)
        assert resp.status_code == 402, f"패스 없음인데 402가 아닌 {resp.status_code}. body={resp.text}"
        payload = resp.json()
        assert payload.get("success") is False, f"success=true로 응답됨: {payload}"
        assert payload.get("error", {}).get("code") == "PASS_REQUIRED", (
            f"기대한 에러코드는 PASS_REQUIRED인데 실제: {payload.get('error')}"
        )
        return f"status=402 code={payload['error']['code']}"
    finally:
        await restore_dev_pass(client)


async def scenario_rate_limit(
    client: httpx.AsyncClient, pool: asyncpg.Pool, dev: DevAuth, ctx: dict[str, Any],
) -> str:
    body = ctx["standard_body"]  # 표준과 동일 바디 재사용 → 매번 캐시 히트, Claude 비용 없음
    statuses = []
    for i in range(3):
        result = await collect_route_stream(client, dev.token, body, timeout=15.0)
        assert result.done_received, (
            f"{i + 1}번째 요청이 정상 완료되지 않음 — 직전 대기(65s)가 부족했을 가능성"
        )
        ctx["created_route_ids"].append(result.route_id)
        statuses.append("200(OK)")

    resp = await post_plain(client, dev.token, body)  # 4번째 — 필터 단계에서 막혀 일반 POST로 충분
    assert resp.status_code == 429, f"4번째 요청에서 429를 기대했는데 {resp.status_code}. body={resp.text}"
    assert resp.headers.get("Retry-After") == "60", (
        f"Retry-After 헤더가 60이 아님: {resp.headers.get('Retry-After')!r}"
    )
    payload = resp.json()
    assert payload.get("error", {}).get("code") == "RATE_LIMIT_EXCEEDED", (
        f"에러코드가 RATE_LIMIT_EXCEEDED가 아님: {payload.get('error')}"
    )
    return f"1~3번째={statuses} 4번째=429(Retry-After=60)"


# --- 실행/출력 ---

async def run_scenario(name: str, coro) -> ScenarioResult:
    t0 = time.monotonic()
    try:
        detail = await coro
        r = ScenarioResult(name, True, time.monotonic() - t0, detail)
        log.info("✅ PASS | %-20s | %.2fs | %s", name, r.duration_s, detail)
    except AssertionError as e:
        r = ScenarioResult(name, False, time.monotonic() - t0, str(e))
        log.error("❌ FAIL | %-20s | %.2fs | %s", name, r.duration_s, e)
    except Exception as e:
        r = ScenarioResult(name, False, time.monotonic() - t0, f"예외: {e!r}")
        log.error("❌ ERROR| %-20s | %.2fs | %s", name, r.duration_s, e)
    return r


def print_summary(results: list[ScenarioResult]) -> None:
    print("\n" + "=" * 70)
    print(f"{'시나리오':<20} {'결과':<6} {'소요시간':>10}  상세")
    print("-" * 70)
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"{r.name:<20} {status:<6} {r.duration_s:>9.2f}s  {r.detail}")
    print("-" * 70)
    total = len(results)
    passed = sum(r.passed for r in results)
    print(f"총 {total}개 중 {passed}개 통과, {total - passed}개 실패")
    print("=" * 70)


async def main() -> None:
    script_start_time = datetime.now(timezone.utc)
    results: list[ScenarioResult] = []
    ctx: dict[str, Any] = {"created_route_ids": []}

    async with httpx.AsyncClient() as client:
        dev = await get_dev_token(client)
        db_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
        pool = await create_pool(db_url)
        try:
            results.append(await run_scenario("표준 루트 생성", scenario_standard(client, pool, dev, ctx)))
            results.append(await run_scenario("Redis 캐시 히트", scenario_cache_hit(client, pool, dev, ctx)))
            results.append(await run_scenario("폴백", scenario_fallback(client, pool, dev, ctx)))
            results.append(await run_scenario(
                "환각 방지(스킵)", asyncio.to_thread(scenario_hallucination_skip),
            ))

            log.info("Rate Limit 카운터 만료 대기 중 (%ds)...", _RATE_LIMIT_WINDOW_WAIT_S)
            await asyncio.sleep(_RATE_LIMIT_WINDOW_WAIT_S)
            results.append(await run_scenario("트립 패스 없음(402)", scenario_pass_required(client, pool, dev)))

            log.info("Rate Limit 카운터 만료 대기 중 (%ds)...", _RATE_LIMIT_WINDOW_WAIT_S)
            await asyncio.sleep(_RATE_LIMIT_WINDOW_WAIT_S)
            results.append(await run_scenario("Rate Limit(429)", scenario_rate_limit(client, pool, dev, ctx)))
        finally:
            try:
                await restore_dev_pass(client)  # 이중 안전장치 — 패스없음 시나리오 실패해도 복구
            except Exception as e:
                log.warning("패스 최종 복구 실패 — 수동 확인 필요: %s", e)
            try:
                async with pool.acquire() as conn:
                    deleted = await conn.fetch(
                        "DELETE FROM routes WHERE user_id = $1::uuid AND created_at >= $2 RETURNING id",
                        dev.user_id, script_start_time,
                    )
                log.info("테스트 루트 정리 완료 — %d건 삭제(user_id=%s)", len(deleted), dev.user_id)
            except Exception as e:
                log.warning("routes 정리 실패 — 수동으로 지워야 할 수 있음: %s", e)
            await pool.close()

    print_summary(results)
    if any(not r.passed for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI 루트 생성 통합 테스트 E2E")
    parser.add_argument("--spring-url", default=None, help="Spring 서버 URL (기본: http://localhost:8080)")
    parser.add_argument("--fastapi-url", default=None, help="FastAPI 서버 URL (기본: http://localhost:8000)")
    args = parser.parse_args()

    if args.spring_url:
        SPRING_URL = args.spring_url
    if args.fastapi_url:
        FASTAPI_URL = args.fastapi_url

    asyncio.run(main())

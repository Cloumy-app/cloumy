#!/usr/bin/env python3
"""
places 운영정보 시드 스크립트 — CSV(사람이 조사해 채운 값)를 DB에 반영한다.

CSV 경로: ai/scripts/data/operational_info.csv (헤더 + 예시 몇 행만 들어있다.
실제 서울 30~50곳 조사는 이 스크립트가 아니라 사람이 해야 하는 일이라 지어내지 않았다.)

⚠️ 빈 칸 = NULL(미조사), 그 외 값 = 조사 결과. 0을 넣으면 "조사했는데 없음"이 된다.
   (V21__add_places_operational_info.sql 헤더 주석과 동일한 규약 — friendly_* 등
   0=없음/1=일부/2=완비 컬럼에서 미조사와 "없음"을 구분해야 챗봇이 잘못 단정하지 않는다.)
   → CSV의 모든 컬럼에 빈 문자열→None 변환 헬퍼(`_empty_to_none`)를 일괄 적용한다.

place_id는 CSV에 직접 적지 않는다. 이름(name) + 주소(address)로 places 테이블을
조회해 해결한다. 이름·주소가 DB와 정확히 일치하지 않아 매칭에 실패한 행은 건너뛰고
끝에 목록으로 출력한다(조용히 버리지 않는다).

멱등성: places 컬럼은 UPDATE(같은 값으로 다시 실행해도 결과 동일), place_closures는
INSERT ... ON CONFLICT DO NOTHING(이미 있는 (place_id, closed_date)는 재삽입하지 않는다).
두 번 실행해도 데이터가 늘어나지 않는다.

⚠️ last_entry_minutes(폐장 N분 전 입장 마감)는 상대값이라 business_hours(폐장 절대시각)가
   없으면 아무 의미가 없다 — 이 조합이면 경고를 출력한다.

실행:
  cd ai && python -m scripts.seed_operational_info --dry-run
  cd ai && python -m scripts.seed_operational_info
  cd ai && python -m scripts.seed_operational_info --csv scripts/data/operational_info.csv
"""
import argparse
import asyncio
import csv
import logging
import os
from datetime import date
from pathlib import Path
from typing import TypedDict

import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from app.config.database import create_pool  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_DEFAULT_CSV_PATH = Path(__file__).parent / "data" / "operational_info.csv"

# CSV closures 컬럼의 날짜:사유 구분자 — "2026-06-01:정기휴관;2026-09-07:시설점검"
_CLOSURE_SEP = ";"
_CLOSURE_DATE_REASON_SEP = ":"
# 요일 배열/override 구분자 — "1;2", "6:10:00-22:00;7:10:00-18:00"
_LIST_SEP = ";"
_OVERRIDE_FIELD_SEP = ":"

# reservation_platform CHECK 제약(V21)과 동일 — 여기서 걸러야 DB 에러 대신 명확한 로그가 남는다
_RESERVATION_PLATFORMS = {"catchtable_global", "catchtable", "naver", "tabling", "phone", "none"}


class ClosureRow(TypedDict):
    closed_date: date
    reason: str | None


class ParsedRow(TypedDict):
    """CSV 한 행을 파싱한 결과. place_id는 아직 없다(이름+주소로 나중에 조회)."""

    name: str
    address: str | None
    business_hours: dict | None
    break_time: dict | None
    last_order_minutes: int | None
    last_entry_minutes: int | None
    reservation_required: bool | None
    walk_in_allowed: bool | None
    reservation_platform: str | None
    cash_only: bool | None
    friendly_foreign_card: int | None
    closed_weekdays: list[int] | None
    closures: list[ClosureRow]


def _empty_to_none(value: str | None) -> str | None:
    """빈 문자열(또는 공백만 있는 문자열)을 None으로 바꾼다.

    CSV의 빈 칸은 전부 "미조사"를 뜻한다(FFE #6). 이 헬퍼를 거치지 않고 값을 그대로
    쓰면 "" 같은 빈 문자열이 그대로 들어가거나, bool/int 파싱 단계에서 예외가 난다.
    """
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _parse_bool(value: str | None) -> bool | None:
    v = _empty_to_none(value)
    if v is None:
        return None
    return v.upper() in ("TRUE", "T", "1", "YES")


def _parse_int(value: str | None) -> int | None:
    v = _empty_to_none(value)
    return int(v) if v is not None else None


def _parse_weekdays(value: str | None) -> list[int] | None:
    """"1;2" → [1, 2] (ISO 1=월 ... 7=일)."""
    v = _empty_to_none(value)
    if v is None:
        return None
    return [int(x) for x in v.split(_LIST_SEP) if x.strip()]


def _parse_weekday_overrides(value: str | None) -> dict[str, dict[str, str]] | None:
    """"6:10:00-22:00;7:10:00-18:00" → {"6": {"open": "10:00", "close": "22:00"}, ...}.

    business_hours.weekday_overrides는 선택 필드다 — 값이 없으면 이 함수가 None을
    반환하고, 호출부는 business_hours dict에 키 자체를 넣지 않는다.
    """
    v = _empty_to_none(value)
    if v is None:
        return None
    overrides: dict[str, dict[str, str]] = {}
    for entry in v.split(_LIST_SEP):
        entry = entry.strip()
        if not entry:
            continue
        weekday, time_range = entry.split(_OVERRIDE_FIELD_SEP, 1)
        open_time, close_time = time_range.split("-", 1)
        overrides[weekday.strip()] = {"open": open_time.strip(), "close": close_time.strip()}
    return overrides


def _parse_business_hours(
    open_: str | None, close_: str | None, weekday_overrides: str | None,
) -> dict | None:
    """open/close/weekday_overrides 세 컬럼을 계획서 확정 형식의 JSONB 하나로 조립한다.

    {"open": "09:00", "close": "18:00",
     "weekday_overrides": {"6": {"open": "10:00", "close": "22:00"}}}   # weekday_overrides는 선택
    """
    open_v, close_v = _empty_to_none(open_), _empty_to_none(close_)
    overrides = _parse_weekday_overrides(weekday_overrides)
    if open_v is None and close_v is None and overrides is None:
        return None
    hours: dict = {}
    if open_v is not None:
        hours["open"] = open_v
    if close_v is not None:
        hours["close"] = close_v
    if overrides is not None:
        hours["weekday_overrides"] = overrides
    return hours


def _parse_break_time(
    start: str | None, end: str | None, except_weekdays: str | None,
) -> dict | None:
    """break_start/break_end/break_except_weekdays → {"start", "end", "except_weekdays"}.

    {"start": "15:00", "end": "17:00", "except_weekdays": [6, 7]}   # except_weekdays는 선택
    """
    start_v, end_v = _empty_to_none(start), _empty_to_none(end)
    except_v = _parse_weekdays(except_weekdays)
    if start_v is None and end_v is None:
        return None
    break_time: dict = {}
    if start_v is not None:
        break_time["start"] = start_v
    if end_v is not None:
        break_time["end"] = end_v
    if except_v is not None:
        break_time["except_weekdays"] = except_v
    return break_time


def _parse_closures(value: str | None) -> list[ClosureRow]:
    """"2026-06-01:정기휴관;2026-09-07:시설점검" → place_closures에 넣을 행 목록.

    사유(reason)는 선택이라 "2026-06-01"만 있어도 된다.
    """
    v = _empty_to_none(value)
    if v is None:
        return []
    closures: list[ClosureRow] = []
    for entry in v.split(_CLOSURE_SEP):
        entry = entry.strip()
        if not entry:
            continue
        if _CLOSURE_DATE_REASON_SEP in entry:
            date_str, reason = entry.split(_CLOSURE_DATE_REASON_SEP, 1)
        else:
            date_str, reason = entry, ""
        closures.append(
            {"closed_date": date.fromisoformat(date_str.strip()), "reason": _empty_to_none(reason)}
        )
    return closures


def parse_row(raw: dict[str, str]) -> ParsedRow:
    """CSV DictReader 한 행 → 파싱된 값. 이 단계에서는 DB를 건드리지 않는다."""
    name = _empty_to_none(raw.get("name"))
    if name is None:
        raise ValueError("name 컬럼은 비워둘 수 없다")

    reservation_platform = _empty_to_none(raw.get("reservation_platform"))
    if reservation_platform is not None and reservation_platform not in _RESERVATION_PLATFORMS:
        raise ValueError(
            f"reservation_platform 값이 CHECK 제약 밖이다: {reservation_platform!r} "
            f"(허용값: {sorted(_RESERVATION_PLATFORMS)})"
        )

    return {
        "name": name,
        "address": _empty_to_none(raw.get("address")),
        "business_hours": _parse_business_hours(
            raw.get("open"), raw.get("close"), raw.get("weekday_overrides"),
        ),
        "break_time": _parse_break_time(
            raw.get("break_start"), raw.get("break_end"), raw.get("break_except_weekdays"),
        ),
        "last_order_minutes": _parse_int(raw.get("last_order_minutes")),
        "last_entry_minutes": _parse_int(raw.get("last_entry_minutes")),
        "reservation_required": _parse_bool(raw.get("reservation_required")),
        "walk_in_allowed": _parse_bool(raw.get("walk_in_allowed")),
        "reservation_platform": reservation_platform,
        "cash_only": _parse_bool(raw.get("cash_only")),
        "friendly_foreign_card": _parse_int(raw.get("friendly_foreign_card")),
        "closed_weekdays": _parse_weekdays(raw.get("closed_weekdays")),
        "closures": _parse_closures(raw.get("closures")),
    }


def read_csv(csv_path: Path) -> list[ParsedRow]:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        return [parse_row(raw) for raw in csv.DictReader(f)]


async def resolve_place_id(conn: asyncpg.Connection, row: ParsedRow) -> "str | None":
    """이름+주소로 places.id를 조회한다. UUID를 CSV에 손으로 적지 않기 위해서다.

    이름·주소를 정확히 일치(공백 트림 후)시켜야 매칭된다 — 애매하게 부분일치를
    허용하면 엉뚱한 장소를 업데이트할 위험이 있다.
    """
    return await conn.fetchval(
        "SELECT id FROM places WHERE btrim(name) = btrim($1) AND btrim(address) = btrim($2)",
        row["name"], row["address"] or "",
    )


async def apply_row(conn: asyncpg.Connection, place_id: str, row: ParsedRow, dry_run: bool) -> None:
    """places UPDATE + place_closures INSERT(멱등). dry_run이면 DB를 쓰지 않는다."""
    if dry_run:
        return

    await conn.execute(
        """
        UPDATE places SET
            business_hours          = COALESCE($2::jsonb, business_hours),
            break_time               = COALESCE($3::jsonb, break_time),
            last_order_minutes       = COALESCE($4, last_order_minutes),
            last_entry_minutes       = COALESCE($5, last_entry_minutes),
            reservation_required     = COALESCE($6, reservation_required),
            walk_in_allowed          = COALESCE($7, walk_in_allowed),
            reservation_platform     = COALESCE($8, reservation_platform),
            cash_only                = COALESCE($9, cash_only),
            friendly_foreign_card    = COALESCE($10, friendly_foreign_card),
            closed_weekdays          = COALESCE($11, closed_weekdays)
        WHERE id = $1
        """,
        place_id,
        _to_jsonb(row["business_hours"]),
        _to_jsonb(row["break_time"]),
        row["last_order_minutes"],
        row["last_entry_minutes"],
        row["reservation_required"],
        row["walk_in_allowed"],
        row["reservation_platform"],
        row["cash_only"],
        row["friendly_foreign_card"],
        row["closed_weekdays"],
    )

    for closure in row["closures"]:
        await conn.execute(
            """
            INSERT INTO place_closures (place_id, closed_date, reason)
            VALUES ($1, $2, $3)
            ON CONFLICT (place_id, closed_date) DO NOTHING
            """,
            place_id, closure["closed_date"], closure["reason"],
        )


def _to_jsonb(value: dict | None) -> "str | None":
    """asyncpg는 dict를 jsonb로 자동 변환하지 않는다 — 문자열로 직렬화해서 넘긴다."""
    if value is None:
        return None
    import json

    return json.dumps(value, ensure_ascii=False)


def _warn_if_last_entry_without_hours(row: ParsedRow) -> None:
    """FFE #8 — last_entry_minutes(폐장 N분 전 상대값)는 business_hours(폐장 절대시각)
    없이는 성립하지 않는다. 조용히 넘어가면 LAST_ENTRY 규칙이 아무 데서도 안 뜬다."""
    if row["last_entry_minutes"] is not None and row["business_hours"] is None:
        log.warning(
            "⚠️  %s: last_entry_minutes=%d 인데 business_hours가 없다 — "
            "LAST_ENTRY 규칙이 성립하지 않는다(폐장 절대시각 없이는 상대값을 계산할 수 없음)",
            row["name"], row["last_entry_minutes"],
        )


async def seed(csv_path: Path, dry_run: bool) -> None:
    rows = read_csv(csv_path)
    log.info("CSV %d행 로드: %s", len(rows), csv_path)

    for row in rows:
        _warn_if_last_entry_without_hours(row)

    db_url = os.environ["POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
    pool = await create_pool(db_url)

    matched = 0
    unmatched: list[str] = []
    try:
        async with pool.acquire() as conn:
            for row in rows:
                place_id = await resolve_place_id(conn, row)
                if place_id is None:
                    unmatched.append(f"{row['name']} ({row['address'] or '주소 없음'})")
                    continue
                matched += 1
                await apply_row(conn, place_id, row, dry_run)
                log.info(
                    "%s %s → place_id=%s (closures=%d)",
                    "[dry-run] 적용 예정" if dry_run else "적용 완료",
                    row["name"], place_id, len(row["closures"]),
                )
    finally:
        await pool.close()

    log.info(
        "🎉 완료 | matched=%d unmatched=%d (dry_run=%s)", matched, len(unmatched), dry_run,
    )
    if unmatched:
        # FFE #9 — 이름 매칭 실패 행을 조용히 버리지 않는다. 목록으로 출력한다.
        log.warning("매칭 실패 행 (%d개) — 이름+주소가 places와 정확히 일치하지 않음:", len(unmatched))
        for entry in unmatched:
            log.warning("  - %s", entry)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="places 운영정보 시드 스크립트")
    parser.add_argument(
        "--csv", type=Path, default=_DEFAULT_CSV_PATH, help="시드할 CSV 경로(기본: scripts/data/operational_info.csv)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="DB 조회(이름+주소 매칭)는 실제로 하되 UPDATE/INSERT는 건너뛴다",
    )
    args = parser.parse_args()

    asyncio.run(seed(args.csv, args.dry_run))

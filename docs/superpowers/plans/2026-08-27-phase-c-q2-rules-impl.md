# Phase C · Q2 — 규칙 6종 구현

> **스택**: FastAPI
> **참조 전문가 스킬**: `fastapi-expert` · `karpathy-guidelines`
> **상위 계획**: `2026-08-27-phase-c-proactive-rules.md`
> **선행**: Q1(완료) · Phase B 전체(완료). 검증만 큐레이션 시드 데이터에 막혀 있다

Q2는 Phase C에서 가장 큰 덩어리다. 담당 파일은 **`ai/app/services/proactive_service.py` 하나**와
그 테스트뿐이다(계약 확장은 Q3).

---

## 🔴 상위 계획서 정정 2건 (이 계획을 짜면서 드러남)

상위 계획서의 규칙 표에 **자기모순**이 있었다. 여기서 확정하고 상위 문서도 함께 고친다.

### 정정 1 — `PAYMENT_WALL`의 대상 슬롯

상위 표는 `PAYMENT_WALL`을 「대상 슬롯 = **다음 슬롯** / 위치 가드 = **불필요**」로 적었다.
**둘은 양립할 수 없다.** "다음 슬롯"은 `_current_and_next`가 주는데, 그 함수는 첫 줄이
`if estimated["confidence"] != "high": return None, None`이다. 즉 다음 슬롯을 쓰는 순간
위치 가드가 강제된다.

→ **`PAYMENT_WALL`은 `today_slots`를 훑는다**(`RESERVATION_WALL`과 같은 형태). 위치 무관 유지.

### 정정 2 — `LAST_TRANSIT`의 위치 가드를 뺀다

노션 재점검(08-18)은 `LAST_TRANSIT`을 "도착 예정 시각이 필요하니 가드 필요"로 분류했다.
구현 관점에서 보니 **틀린 분류다.**

- `leave_by`는 **오늘 마지막 슬롯 → 숙소** 구간에서 계산한다. 유저의 현재 위치가 아니다
- `LAST_TRANSIT`이 필요한 시각은 밤(18시 이후)인데, 그때는 마지막 일정이 끝나가거나 이미 끝나서
  **`_estimate_current_slot`의 confidence가 낮게 나올 가능성이 크다.**
  가드를 붙이면 **정확히 필요한 시간대에 규칙이 죽는다** — 챗봇 장소 추가 기능이
  "밤에 통째로 비활성"이던 것과 같은 실패 형태다(`2026-07-29-chat-place-insertion.md`)
- 유저가 이미 숙소로 출발했다면 배너는 무해하다

→ **위치 가드는 `BREAK_TIME`·`LAST_ENTRY` 2종에만 둔다.** 둘은 "다음 슬롯 도착 시각"이
판정의 전부라 가드가 본질적이다.

---

## Interfaces

### Consumes

```python
# Q1 (완료) — transport_service.py
async def find_last_departure(client, lat1, lng1, lat2, lng2, api_key, base_date,
                              search_from_hour=22, search_to_hour=26) -> dict | None
# 반환: {"leave_by": datetime(KST aware), "minutes": int, "fare": int | None, "summary": str | None}

# Phase B (완료) — _load_slots가 이미 p.id AS place_id를 뽑는다
```

### Produces — Q3가 그대로 받는다

| type | priority | params |
|---|---|---|
| `LAST_TRANSIT` | 1 | `placeId: str` · `placeName: str` · `leaveByTime: datetime(ISO)` · `minutes: int` · `fare: int \| null` |
| `CLOSED_DAY` | 1 | `placeId: str` · `placeName: str` · `day: int` |
| `BREAK_TIME` | 2 | `placeId: str` · `placeName: str` · `breakStart: time` · `breakEnd: time` |
| `RESERVATION_WALL` | 2 | `placeId: str` · `placeName: str` · `reservationPlatform: str \| null` |
| `PAYMENT_WALL` | 2 | `placeId: str` · `placeName: str` · `kind: "cash_only" \| "no_foreign_card"` |
| `LAST_ENTRY` | 3 | `placeId: str` · `placeName: str` · `lastEntryTime: time` · `closeTime: time` |

`reservationPlatform`은 **nullable**이다 — 예약이 필수인 건 알지만 어느 플랫폼인지는 미조사일 수 있다.
상위 계획서엔 `Literal[...]`로만 적혀 있었으나 `| None`이 맞다.

`placeId`는 전부 `str(...)`. `placeName`은 자유 문자열이라 이미 `_FREE_TEXT_FIELDS`에 있다 —
**새로 추가할 자유 문자열은 없다**(노선 요약·숙소명을 params에 넣지 않기로 한 결정 덕분).

---

## 실패 시나리오 (FFE)

| # | 실패 상황 | 대응 |
|---|---|---|
| 1 | **미조사 장소에 단정 발화** | `is None`(미조사) 검사와 falsy(조사했는데 아님) 검사를 **반드시 분리**. `if not slot["cash_only"]`만 쓰면 21,000여 건의 미조사 장소가 전부 "현금전용 아님"으로 취급된다 |
| 2 | `_current_and_next`의 `next_dict`에 운영정보가 없다 | 지금 `{place_name, start_time}` 2개뿐이다. **`next_dict`를 확장해야 한다** — 안 하면 BREAK_TIME·LAST_ENTRY가 데이터를 못 본다 |
| 3 | 규칙이 하루 종일 발동 | 시간창을 둔다. `_ARRIVAL_WARN_WINDOW_MIN`(도착 임박 2종), `_LAST_TRANSIT_WINDOW_MIN`(막차). 상태형 3종(CLOSED_DAY·RESERVATION_WALL·PAYMENT_WALL)은 시간창이 없는 게 정상이고 **Phase B의 서버 dismiss가 그걸 감당한다** |
| 4 | `business_hours` 형식 오류(수기 CSV) | 파서가 예외를 삼키고 `None` 반환 → 규칙 스킵 |
| 5 | `placeId`를 `uuid.UUID`로 넣는다 | `str(...)`. JSON 직렬화 실패 + dismiss 필터 무력화 |
| 6 | 자정 넘긴 `leave_by`를 오늘 날짜로 비교 | `find_last_departure`가 aware datetime을 주므로 그대로 `snap["now"]`와 뺀다. `.time()`으로 자르지 마라 |
| 7 | Tmap 이분 탐색이 폴링마다 돈다 | `_load_last_transit`의 3중 가드(phase·18시·Redis 캐시) |
| 8 | 규칙 안에서 `await`·DB·`datetime.now()` 호출 | 순수 함수 원칙 위반. 비동기는 전부 `_build_snapshot`이 한다 |

---

## Step 1 — 상수 추가

`:22-37` 임계 상수 블록에 이어서 (기존 관례: 한곳에 모은다):

```python
_ARRIVAL_WARN_WINDOW_MIN = 60      # 다음 슬롯 도착 N분 전부터 BREAK_TIME·LAST_ENTRY 평가
_LAST_TRANSIT_WINDOW_MIN = 60      # 막차 출발 N분 전부터 LAST_TRANSIT 발동
_LAST_TRANSIT_EVAL_FROM_HOUR = 18  # 이 시각 이후에만 막차를 계산한다(비용 방어)
_LAST_TRANSIT_CACHE_TTL_S = 86_400 # 막차는 (출발지, 도착지, 날짜)에 하루 불변
```

## Step 2 — 영업시간 파서 (순수 함수)

별도 모듈로 빼지 않는다. 소비처가 이 파일 안 2개 규칙뿐이다.

```python
def _hours_for(business_hours: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"open","close","weekday_overrides"} → 그 요일의 (open, close).
    weekday는 ISO 1=월…7=일 (V21 closed_weekdays 규약과 동일).
    미조사(None)거나 형식이 깨졌으면 None — 수기 CSV라 깨진 값이 들어올 수 있다(FFE #4)."""


def _break_for(break_time: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"start","end","except_weekdays"} → 그 요일의 (start, end).
    except_weekdays에 포함된 요일이면 None(그날은 브레이크타임 없음)."""
```

두 함수 모두 `try/except (KeyError, ValueError, TypeError): return None`으로 감싼다.

## Step 3 — `_load_slots` SELECT 확장

Phase B가 넣은 `p.id AS place_id` 뒤에 운영정보 10개를 더한다:

```
p.business_hours, p.break_time, p.last_order_minutes, p.last_entry_minutes,
p.reservation_required, p.walk_in_allowed, p.reservation_platform,
p.cash_only, p.friendly_foreign_card, p.closed_weekdays
```

⚠️ `:344-348`의 `start_time IS NOT NULL` 금지 주석을 어기지 마라.

## Step 4 — `_current_and_next`의 `next_dict` 확장 (FFE #2)

지금 `{place_name, start_time}` 2개만 담는다. BREAK_TIME·LAST_ENTRY가 볼 수 있게 넓힌다:

```python
    next_dict = {
        "place_id": next_slot["place_id"],
        "place_name": next_slot["place_name"],
        "start_time": next_slot["start_time"],
        "business_hours": next_slot["business_hours"],
        "break_time": next_slot["break_time"],
        "last_order_minutes": next_slot["last_order_minutes"],
        "last_entry_minutes": next_slot["last_entry_minutes"],
    }
```

`current_dict`는 건드리지 않는다 — T2·T7이 쓰는 것뿐이고 운영정보가 필요 없다.
이 함수의 긴 독스트링(왜 "바로 다음" 슬롯이어야 하는지)은 그대로 둔다.

## Step 5 — `_load_closures` 신규

```python
async def _load_closures(db: asyncpg.Pool, route_id: str, today: date) -> set[str]:
    """오늘 휴관인 place_id 집합(str). closed_weekdays(요일 규칙)는 슬롯 행에 이미 실려
    오므로 여기선 날짜 예외(place_closures)만 본다 — 규칙에서 둘을 OR로 합친다."""
    rows = await db.fetch(
        "SELECT DISTINCT pc.place_id FROM place_closures pc "
        "JOIN route_slots rs ON rs.place_id = pc.place_id "
        "WHERE rs.route_id = $1 AND pc.closed_date = $2",
        route_id, today,
    )
    return {str(r["place_id"]) for r in rows}
```

`during`일 때만 호출한다. `str()`로 담는 이유는 규칙이 `str(slot["place_id"])`와 비교하기 때문이다.

## Step 6 — `_load_last_transit` 신규 (3중 가드)

```python
async def _load_last_transit(
    redis, route: asyncpg.Record, today_slots: list[asyncpg.Record], now: datetime
) -> dict | None:
    """오늘 마지막 슬롯 → 그날 밤 숙소의 막차. 계산 안 할 조건이면 None.
    반환: {"placeId": str, "placeName": str, "leaveBy": datetime, "minutes": int,
           "fare": int | None}"""
```

순서대로:
1. `now.hour < _LAST_TRANSIT_EVAL_FROM_HOUR` → `None` (비용 방어)
2. `today_slots`가 비었거나 좌표를 못 구하면 → `None`
3. 숙소 좌표 조회 — `_load_stay_distances`가 이미 Day별 숙소를 뽑는 쿼리를 갖고 있으니 그 패턴 재사용
4. Redis 캐시 조회. 키 `transit:last:{place_id}:{lat},{lng}:{yyyy-mm-dd}`, TTL `_LAST_TRANSIT_CACHE_TTL_S`
5. 미스면 `find_last_departure` 호출 후 캐시 저장
6. 모든 예외는 `logger.warning` 후 `None` (FFE)

⚠️ 캐시에 `datetime`을 넣을 때 **ISO 문자열로 직렬화**하고 읽을 때 되돌린다. Redis는 문자열만 담는다.

## Step 7 — `_build_snapshot` during 분기 확장

```python
    snap["closures_today"] = await _load_closures(db, route["id"], now.date())
    snap["last_transit"] = await _load_last_transit(redis, route, today_slots, now)
```

`pre_trip` 분기는 건드리지 않는다 — 6종 전부 여행 중 규칙이다.

## Step 8 — 규칙 6종

### 공통 골격 — NULL 가드 (FFE #1, 6종 전부 동일)

```python
    if slot["cash_only"] is None:   # 미조사 — 개입을 만들지 않는다
        return None
    if not slot["cash_only"]:       # 조사했는데 현금전용이 아님
        return None
```

**`is None`과 falsy를 한 줄로 합치지 마라.** 합치면 미조사 21,000여 건이 전부 "아님"으로 취급된다.

### `_rule_last_transit` (p1, 위치 가드 없음)

```python
    lt = snap.get("last_transit")
    if lt is None:
        return None
    minutes_left = (lt["leaveBy"] - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _LAST_TRANSIT_WINDOW_MIN):
        return None
    return {"type": "LAST_TRANSIT", "priority": 1, "params": {
        "placeId": lt["placeId"], "placeName": lt["placeName"],
        "leaveByTime": lt["leaveBy"].isoformat(),
        "minutes": lt["minutes"], "fare": lt["fare"],
    }}
```

### `_rule_closed_day` (p1, 위치 가드 없음)

오늘 슬롯을 순회해 **첫 번째 휴관 장소**에 발동한다.

- 날짜 예외: `str(slot["place_id"]) in snap["closures_today"]` → 발동 (이건 확정 증거다)
- 요일 규칙: `slot["closed_weekdays"] is None` → 그 슬롯은 판단 불가라 **건너뛴다**(다음 슬롯 계속 확인).
  `None`이 아니면 `today.isoweekday() in closed_weekdays`로 판정
- params: `placeId` · `placeName` · `day`(= `snap["today_day_number"]`)

### `_rule_break_time` (p2, **위치 가드 있음**)

```python
    if snap["estimated"]["confidence"] != "high":
        return None
    nxt = snap.get("next_slot")
    if nxt is None or nxt["start_time"] is None:
        return None
    if nxt["break_time"] is None:      # 미조사
        return None
    arrival = _combine(snap["today_date"], nxt["start_time"])
    minutes_left = (arrival - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _ARRIVAL_WARN_WINDOW_MIN):
        return None
    brk = _break_for(nxt["break_time"], arrival.isoweekday())
    if brk is None:                    # 그 요일은 브레이크타임 없음
        return None
    start, end = brk
```

`last_order_minutes`는 **컷오프 계산에만** 쓴다 — 라스트오더가 있으면 실질 마감이 그만큼 앞당겨진다:

```python
    cutoff = start
    if nxt["last_order_minutes"] is not None:
        cutoff = (datetime.combine(arrival.date(), start) -
                  timedelta(minutes=nxt["last_order_minutes"])).time()
    if not (cutoff <= arrival.time() < end):
        return None
```

params엔 `breakStart`·`breakEnd`만 넣는다(문구는 브레이크타임 구간을 알려주면 충분하다).

### `_rule_last_entry` (p3, **위치 가드 있음**)

`break_time` 대신 `last_entry_minutes` + `business_hours`를 본다. **둘 다 NOT NULL이어야 한다** —
`last_entry_minutes`는 "폐장 N분 전"이라는 상대값이라 `business_hours` 없이는 절대시각을 못 만든다.

```python
    hours = _hours_for(nxt["business_hours"], arrival.isoweekday())
    if hours is None:
        return None
    _open, close = hours
    last_entry = (datetime.combine(arrival.date(), close) -
                  timedelta(minutes=nxt["last_entry_minutes"])).time()
    if arrival.time() < last_entry:    # 아직 여유 있음
        return None
```

params: `placeId` · `placeName` · `lastEntryTime`(= `last_entry`) · `closeTime`(= `close`)

### `_rule_reservation_wall` (p2, 위치 가드 없음)

오늘 슬롯 순회, 첫 번째 해당 장소:
- `reservation_required is None` → 건너뜀 (미조사)
- `not reservation_required` → 건너뜀
- `walk_in_allowed is True` → 건너뜀 (예약 필수여도 워크인이 되면 벽이 아니다)
- params: `placeId` · `placeName` · `reservationPlatform`(nullable 그대로)

### `_rule_payment_wall` (p2, 위치 가드 없음)

오늘 슬롯 순회, 첫 번째 해당 장소. 두 가지 원인을 `kind`로 구분한다
(`WEATHER_ALERT`가 `kind` 서브키를 쓰는 것과 같은 형태):

- `cash_only is True` → `kind="cash_only"`
- `friendly_foreign_card == 0` → `kind="no_foreign_card"` (`0`은 "조사했는데 없음", `None`은 미조사)
- 둘 다 아니면 건너뜀

## Step 9 — `_RULES_DURING` 순서

`_select`가 `min(priority)`이고 **동점이면 리스트 순서가 이긴다**. 15종이 되므로 명시한다:

```python
_RULES_DURING = [
    _rule_flight_departure,    # 1
    _rule_return_departure,    # 1
    _rule_last_transit,        # 1 — 신규. 복구 불가라 같은 1 중에서도 앞
    _rule_closed_day,          # 1 — 신규
    _rule_departure_soon,      # 2
    _rule_break_time,          # 2 — 신규
    _rule_reservation_wall,    # 2 — 신규
    _rule_payment_wall,        # 2 — 신규
    _rule_empty_day,           # 3
    _rule_last_entry,          # 3 — 신규
    _rule_weather_alert,       # 4
    _rule_budget_over,         # 5
    _rule_bookmark_nearby,     # 6
    _rule_free_gap,            # 7
]
```

---

## 테스트

`ai/tests/test_proactive_rules.py`. 기존 파일은 **DB·네트워크 목킹 없이 dict 스냅샷 하나로
순수 함수를 검증**한다. 그 구조를 그대로 따르고 섹션 주석(`# ====== T1. ... ======`) 관례도 유지한다.

규칙당 최소 4케이스:

| 케이스 | 기대 |
|---|---|
| 발동 | dict 반환, `type`·`priority`·`params` 확인 |
| **데이터 NULL(미조사)** | `None` ← FFE #1의 핵심. 이게 없으면 회귀를 못 잡는다 |
| 조건 불만족(조사했는데 해당 없음) | `None` |
| (위치 의존 2종) `confidence: "low"` | `None` |

추가로:
- `_hours_for` / `_break_for` 단독 테스트 — `weekday_overrides` 적용 · `except_weekdays` 제외 · 깨진 형식이 `None`
- `_rule_payment_wall`이 `friendly_foreign_card`가 `0`일 때와 `None`일 때 **다르게** 동작하는지
  (같은 falsy라 실수하기 쉬운 자리)

---

## 검증 방법

```bash
cd ai && ./.venv/bin/python -m pytest tests/ -q
# 기대: 183 + 신규분 전부 통과

# 순수 함수 원칙 위반 정적 확인 — 규칙 함수 본문에 await가 없어야 한다
cd ai && grep -n "await" app/services/proactive_service.py | grep -A0 "_rule_"
# 기대: 히트 0건

# 시드 데이터 적재 후 통합 (데이터 입력 완료 시)
cd ai && ./.venv/bin/python -m scripts.seed_operational_info
docker compose up -d --build fastapi spring
curl localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"

# FFE #1 — 시드 안 된 장소만으로 만든 루트에선 6종이 하나도 안 떠야 한다
# FFE #7 — 같은 루트를 연속 3회 조회해도 Tmap 호출이 1회뿐인지 로그로 확인
```

---

## 체크리스트

- [ ] 규칙 함수 본문에 `await`·DB·`datetime.now()`가 없다
- [ ] 6종 전부 `is None` 가드와 falsy 검사를 **분리**했다
- [ ] `params["placeId"]`가 `str`
- [ ] 위치 가드가 `BREAK_TIME`·`LAST_ENTRY` **2종에만** 있다 (LAST_TRANSIT엔 없다)
- [ ] `_current_and_next`의 `next_dict`를 확장했고 `current_dict`는 안 건드렸다
- [ ] `_load_slots`의 `start_time IS NOT NULL` 금지 주석을 어기지 않았다
- [ ] `_RULES_DURING` 순서가 계획서대로
- [ ] `_load_last_transit`이 3중 가드를 전부 갖췄다
- [ ] Redis 캐시에 datetime을 ISO 문자열로 넣고 되돌린다
- [ ] `friendly_foreign_card`의 `0`과 `None`을 구분하는 테스트가 있다

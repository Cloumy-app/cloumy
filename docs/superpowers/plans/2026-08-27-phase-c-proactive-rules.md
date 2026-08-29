# Phase C — 프로액티브 규칙 6종

> **스택**: FastAPI(주) · Spring(한 줄) · Frontend
> **참조 전문가 스킬**: `fastapi-expert` · `frontend-expert` · `spring-expert` · `karpathy-guidelines`
> **선행**: Phase B 전체 (dismiss 서버 필터링 · V23 `place_closures` · 큐레이션 시드)
> **노션**: [프로액티브 규칙 6종 신설](https://app.notion.com/p/3af3c69447de81dabdb7f4cbd312be7a)

출시 최소범위의 **마지막 기능**이다. 이걸로 V21 스키마 18컬럼이 처음으로 실제 값을 갖고 화면에 나온다.

> 💡 **LLM 호출이 0건이다.** 규칙 6종은 전부 순수 함수 판단이고, 외부 API는 이미 쓰고 있는
> Tmap 하나뿐이다(신규 API 0개). 자금 없이 마무리하는 범위로 이만한 게 없다.

---

## 🔴 설계 충돌 — 먼저 해결하고 시작한다

`proactive_service.py` 헤더 독스트링이 못박은 원칙:

> 규칙 함수는 전부 순수 함수다. **DB·`datetime.now()`·네트워크를 규칙 함수 안에서 부르지 않는다.**
> 스냅샷 dict만 받아 dict | None을 반환한다 — 이래야 pytest에서 dict 하나로 단독 검증된다.

그런데 `LAST_TRANSIT`은 Tmap을 **여러 번** 호출해야 한다(이분 탐색 5~6회).
규칙 안에서 부르면 원칙이 깨지고 기존 테스트 40여 개의 구조도 함께 무너진다.

**해결**: 비동기 작업은 전부 `_build_snapshot`이 하고, 규칙은 결과만 읽는다.

```python
# _build_snapshot 안에서 (async)
snap["last_transit"] = await _load_last_transit(...)   # {"leaveBy": datetime, "fare": int, ...} | None

# _rule_last_transit 안에서 (순수 동기)
lt = snap.get("last_transit")
if lt is None:
    return None   # 계산 안 됐거나 실패 — FFE
```

기존 규칙이 `snap["day_forecast"]`(Redis 경유 날씨)를 읽는 것과 **정확히 같은 구조**다. 새로운 패턴이 아니다.

### 비용 방어 — 이분 탐색을 아무 때나 돌리면 안 된다

폴링마다 Tmap을 5~6회 부르면 요금과 지연이 감당이 안 된다. 3중 가드:

1. **phase 가드** — `during`일 때만
2. **시간 가드** — `now.hour >= _LAST_TRANSIT_EVAL_FROM_HOUR`(18시) 이후에만.
   낮에 막차를 안내할 이유가 없다
3. **Redis 캐시** — 막차 시각은 `(출발지, 도착지, 날짜)`에 대해 **하루 불변**이다.
   슬롯 쌍 단위로 캐시하면 사실상 하루 1회가 된다

`_trip_phase`가 `out_of_range`에서 쿼리 1개로 끝내는 FFE #1과 같은 발상이다.

---

## 작업 분할

| 팩 | 범위 | 의존 |
|---|---|---|
| **Q1** | `transport_service.py` — `search_dttm` · `find_last_departure()` · `fare` 추출 | 없음 (DB 무관, 지금 바로 착수 가능) |
| **Q2** | 스냅샷 확장 + 규칙 6종 + priority 재배열 + 테스트 | Q1의 **시그니처**만 (구현 완료 전에도 병렬 가능) |
| **Q3** | 계약 확장 — schemas · gloss · TYPE_PATTERN · 프론트 타입/문구/i18n · API 문서 | Q2의 params 확정 |

### Interfaces — 팩 사이에 오가는 것 전부

각 팩의 구현자는 **자기 팩만 본다.** 이웃 팩이 쓰는 이름과 타입을 여기서만 배운다.
이름이 하나라도 어긋나면 합류 시점에 깨진다.

#### Q1 Produces

```python
# transport_service.py — 기존 함수 시그니처 확장 (search_dttm은 선택, 기본 None)
async def _tmap_transit_route(
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float,
    api_key: str, search_dttm: str | None = None,      # yyyymmddhhmi
) -> dict | None:
    """반환: {"minutes": int, "fare": int | None, "summary": str | None,
             "detail": list[dict] | None} / 경로 없으면 None
    ⚠️ 기존 3-tuple 반환에서 dict로 바뀐다 — enrich_transport 언팩도 함께 고칠 것"""


async def find_last_departure(
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float,
    api_key: str, base_date: date,
    search_from_hour: int = 22,
    search_to_hour: int = 26,        # 26 = 다음 날 02:00 (자정 넘김을 시각이 아니라 시간으로 표현)
) -> dict | None:
    """반환: {"leave_by": datetime(KST aware), "minutes": int,
             "fare": int | None, "summary": str | None} / 경로를 아예 못 찾으면 None"""


_LAST_TRANSIT_PRECISION_MIN: int = 15   # 이분 탐색 정밀도(분) → 호출 5~6회
```

#### Q2 Consumes

- Q1의 `find_last_departure` (위 시그니처 그대로)
- Phase B가 넣은 `_load_slots`의 `p.id AS place_id`

#### Q2 Produces — 규칙 6종의 `params` 키 (Q3가 이걸 그대로 받는다)

`placeId`는 **전부 `str`**(FFE #5), `placeName`은 전부 자유 문자열(이미 `_FREE_TEXT_FIELDS`에 있음).

| type | params |
|---|---|
| `LAST_TRANSIT` | `placeId: str` · `placeName: str` · `leaveByTime: datetime(ISO)` · `minutes: int` · `fare: int \| null` |
| `CLOSED_DAY` | `placeId: str` · `placeName: str` · `day: int` |
| `BREAK_TIME` | `placeId: str` · `placeName: str` · `breakStart: time` · `breakEnd: time` |
| `LAST_ENTRY` | `placeId: str` · `placeName: str` · `lastEntryTime: time` · `closeTime: time` |
| `RESERVATION_WALL` | `placeId: str` · `placeName: str` · `reservationPlatform: str \| null` |
| `PAYMENT_WALL` | `placeId: str` · `placeName: str` · `kind: Literal["cash_only","no_foreign_card"]` |

**시각 타입 규약** — 아무렇게나 고르지 않는다:
- **날짜를 품는 값**(`leaveByTime`은 자정을 넘는다) → `datetime` ISO. 프론트가 `formatClockTime`으로 로케일 포맷
  (`FLIGHT_DEPARTURE`와 동일)
- **벽시계 값**(`business_hours`에서 온 시:분) → `time`(`"HH:MM:SS"`). 프론트가 `.slice(0, 5)`
  (`PRE_TRIP_BRIEFING.flags.first_slot`과 동일)

`find_last_departure`는 `leave_by`(snake)로 주고 규칙 함수가 `leaveByTime`(camel)으로 바꿔 담는다 —
params는 앱이 i18next 보간에 그대로 쓰므로 camelCase가 규약이다.

#### Q3 Consumes

- 위 params 표 전체 (Pydantic·TS·i18n 키가 이 이름과 1:1이어야 한다)

#### 이 계획이 params에 **넣지 않기로** 한 것

- **노선 요약**(`summary`, 예: `"버스 143 → 지하철 2호선"`) — 배너 한 줄에 안 들어가고,
  넣으면 `_FREE_TEXT_FIELDS`에 새 필드를 추가해야 한다(프롬프트 주입 통로가 하나 늘어난다).
  `find_last_departure`는 반환하되 규칙이 버린다
- **숙소명** — 같은 이유. `LAST_TRANSIT` 문구는 "숙소까지"로 충분하다

---

## 실패 시나리오 (FFE)

| # | 실패 상황 | 감지 | 대응 |
|---|---|---|---|
| 1 | **미조사 장소에 단정 발화** | — | **NULL 가드가 전부다.** `IS NOT NULL`이 아니면 **개입 자체를 만들지 않는다**. V21 주석: `NULL`=미조사, `0`=조사했는데 없음. 21,000여 건 중 시드한 30~50곳만 값이 있다 |
| 2 | 자정 경계 — 이분 탐색이 `00:00`을 넘는다 | 막차가 23:xx로만 나옴 | `searchDttm`의 `yyyymmdd`가 그때 **다음 날**로 넘어가야 한다. 시각(hour)이 아니라 **base_date + timedelta(hours=h)** 로 계산해 날짜가 자동으로 넘어가게 한다. **여기서 틀리면 규칙 전체가 무의미** |
| 3 | Tmap 5~6회 호출 폭증 | 요금·지연 | 3중 가드(phase·시간·Redis 캐시). 위 참조 |
| 4 | Tmap 장애 | `httpx` 예외 | `snap["last_transit"] = None` → 규칙 스킵. `enrich_transport`가 이미 같은 폴백을 한다(`transport_service.py:124-125`) |
| 5 | `placeId`를 `uuid.UUID` 객체로 넣는다 | JSON 직렬화 실패 / dismiss 필터 무력화 | **`str(...)`로 감싼다.** Phase B 인계 사항 |
| 6 | 자유 문자열이 시스템 프롬프트로 샌다 | — | 새 params의 자유 문자열(`placeName`, 역명 등)을 `chat_service._FREE_TEXT_FIELDS`에 **반드시** 추가. `placeName`은 이미 있고, LAST_TRANSIT이 역명을 넣는다면 그것도 추가 |
| 7 | `business_hours` 형식 오류(수기 입력) | 파싱 예외 | 파서가 예외를 삼키고 `None` 반환 → 규칙 스킵. 수기 CSV라 깨진 값이 들어올 수 있다 |
| 8 | 규칙 15종이 되며 낮은 우선순위가 영영 안 뜬다 | — | Phase B의 dismiss 서버 필터링이 이걸 푼다. `_select`는 `min()`이라 **동점이면 리스트 순서가 이긴다** — `_RULES_DURING` 순서를 의도적으로 정한다 |
| 9 | 위치 추정이 낮은데 도착 시각을 단정 | 엉뚱한 시점에 발화 | `confidence != "high"`면 시각 의존 3종 스킵 (`_rule_departure_soon:187`이 원형) |

---

# Q1 — `transport_service.py`

## 1. `_tmap_transit_route`에 `search_dttm` 추가

현재 요청 바디(`:79-84`)에 `startX/startY/endX/endY/count/lang/format`만 보낸다.
Tmap 대중교통 API는 `searchDttm`(`yyyymmddhhmi`) 옵션으로 **타임머신 조회**를 지원한다.

```python
    body = {
        "startX": str(lng1), "startY": str(lat1),
        "endX": str(lng2), "endY": str(lat2),
        "count": 1, "lang": 0, "format": "json",
    }
    if search_dttm is not None:
        body["searchDttm"] = search_dttm      # yyyymmddhhmi — 미래 시각 조회(타임머신)
```

기존 호출부(`enrich_transport:121`)는 인자를 안 넘기므로 **동작이 바뀌지 않는다.**

## 2. `fare` 추출 — 이미 받고 있는 데이터다

`itinerary`에 `fare.regular.totalFare`가 오는데 지금 `totalTime`만 꺼내 쓴다(`:91`).
추가 비용 0이고, 노션 04 Feature 명세의 이동 카드 문구가 `"🚇 34분 ₩1,450 환승1"`인데
**요금이 빠진 채로 나가고 있다.**

`_tmap_transit_route`의 반환을 tuple에서 **dict로 바꾼다** — 지금도 3-tuple인데 여기서 4개가 되면
호출부에서 순서를 헷갈리기 쉽다.

```python
    return {
        "minutes": round(itinerary["totalTime"] / 60),
        "fare": itinerary.get("fare", {}).get("regular", {}).get("totalFare"),  # 없을 수 있다
        "summary": _build_transit_summary(itinerary),
        "detail": _build_transit_detail(itinerary),
    }
```

`enrich_transport`(`:118-134`)의 언팩도 함께 고친다. `transit_summary`/`transit_detail`은
이미 `route_slots`에 저장되는 값이라 **저장 포맷을 바꾸지 않도록 주의**한다
(요금 표기까지 UI에 붙이는 건 이번 범위 밖 — 값만 흘려보내고 끝낸다).

## 3. `find_last_departure()` — 이분 탐색

**왜 이 방식인가**: 노선별 막차 시각(ODsay·서울교통공사)은 **역 단위 값**이라 환승 성립 여부를
우리가 다시 계산해야 하고 지하철만 커버한다. 미래 시각을 이분 탐색해 **경로가 사라지는 시점**을
찾으면 **환승 연결까지 성립하는 마지막 경로**가 나온다. **신규 API 0개.**

```python
# 22:00 ~ 26:00(= 다음 날 02:00)을 이분 탐색. 경로가 있는 마지막 시각을 찾는다.
# 시각을 hour 숫자로 다루고 base_date에 timedelta로 더한다 — 이래야 자정을 넘길 때
# yyyymmdd가 자동으로 다음 날이 된다(FFE #2. 여기서 틀리면 규칙 전체가 무의미).
lo, hi = search_from_hour, search_to_hour
while hi - lo > _LAST_TRANSIT_PRECISION_MIN / 60:
    mid = (lo + hi) / 2
    at = datetime.combine(base_date, time(0, 0), tzinfo=_KST) + timedelta(hours=mid)
    if await _tmap_transit_route(..., search_dttm=at.strftime("%Y%m%d%H%M")) is not None:
        lo = mid          # 아직 경로가 있다 → 더 늦게
    else:
        hi = mid          # 경로가 끊겼다 → 더 이르게
```

- 정밀도 `_LAST_TRANSIT_PRECISION_MIN = 15`(분) → 호출 5~6회
- `lo`에서 한 번도 경로를 못 찾으면 `None` (그 구간은 애초에 대중교통이 없다)
- 모든 예외는 `None`으로 수렴 (FFE #4)

---

# Q2 — 스냅샷 확장 + 규칙 6종

## 1. `_load_slots` SELECT 확장

Phase B에서 `p.id AS place_id`를 이미 넣었다. 여기에 운영정보를 더한다:

```
p.business_hours, p.break_time, p.last_order_minutes, p.last_entry_minutes,
p.reservation_required, p.walk_in_allowed, p.reservation_platform,
p.cash_only, p.friendly_foreign_card, p.closed_weekdays
```

⚠️ `:344-348`의 `start_time IS NOT NULL` 금지 주석을 어기지 마라.

## 2. `_load_closures` 신규 (V23 조회)

```python
async def _load_closures(db: asyncpg.Pool, route_id: str, today: date) -> set[str]:
    """오늘 휴관인 place_id 집합. closed_weekdays(요일)는 슬롯 행에 이미 실려 오므로
    여기선 날짜 예외(place_closures)만 본다 — 둘을 규칙에서 OR로 합친다."""
```

`during`일 때만 호출한다.

## 3. 영업시간 파서 (순수 함수)

`business_hours`·`break_time` JSONB를 읽는 헬퍼를 `proactive_service.py`의 상수부 아래에 둔다.
별도 모듈로 빼지 않는다 — 소비처가 이 파일 안 3개 규칙뿐이다.

```python
def _hours_for(business_hours: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"open","close","weekday_overrides"} → 그 요일의 (open, close). 형식이 깨졌으면 None(FFE #7)."""

def _break_for(break_time: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"start","end","except_weekdays"} → 그 요일의 (start, end). except면 None."""
```

`weekday`는 **ISO 1=월…7=일** (V21 `closed_weekdays` 규약과 동일).

## 4. `last_transit` 스냅샷

`_build_snapshot`의 `during` 분기 끝에:

```python
    snap["last_transit"] = await _load_last_transit(redis, route, today_slots, now)
```

`_load_last_transit`이 3중 가드를 전부 담당한다(시간 가드 → Redis 캐시 → Tmap).

```python
_LAST_TRANSIT_EVAL_FROM_HOUR: int = 18   # 이 시각 이후에만 막차를 계산한다(비용 방어)
_LAST_TRANSIT_CACHE_TTL_S: int = 86_400  # 막차는 (출발지, 도착지, 날짜)에 하루 불변


async def _load_last_transit(
    redis, route: asyncpg.Record, today_slots: list[asyncpg.Record], now: datetime
) -> dict | None:
    """오늘 마지막 슬롯 → 그날 밤 숙소의 막차. 계산 안 할 조건이면 None.
    반환: {"placeId": str, "placeName": str, "leaveBy": datetime, "minutes": int,
           "fare": int | None} / 가드에 걸리거나 실패하면 None"""
```

캐시 키: `transit:last:{from_place_id}:{to_lat},{to_lng}:{yyyy-mm-dd}`, TTL `_LAST_TRANSIT_CACHE_TTL_S`.
목적지는 **그날 밤 묵는 숙소** — `_load_stay_distances`가 이미 숙소를 Day별로 뽑는 쿼리를 갖고 있으니
그 패턴을 재사용한다.

## 5. 규칙 6종

| type | priority | 위치 가드 | 대상 슬롯 | 데이터 |
|---|---|---|---|---|
| `LAST_TRANSIT` | **1** | ~~필요~~ **불필요** | 오늘 마지막 슬롯 → 숙소 | `snap["last_transit"]` |
| `CLOSED_DAY` | 1 | 불필요 | 오늘 슬롯 중 첫 휴관 장소 | `closed_weekdays` OR `place_closures` |
| `BREAK_TIME` | 2 | 필요 | 다음 슬롯 | `break_time`, `last_order_minutes` |
| `RESERVATION_WALL` | 2 | 불필요 | 오늘 남은 슬롯 중 첫 예약필수 | `reservation_required`, `walk_in_allowed`, `reservation_platform` |
| `PAYMENT_WALL` | **2** | 불필요 | ~~다음 슬롯~~ **오늘 슬롯 순회** | `cash_only`, `friendly_foreign_card` |
| `LAST_ENTRY` | **3** | 필요 | 다음 슬롯 | `last_entry_minutes` + `business_hours` |

**priority는 실패 비용 기준으로 재배열했다**(Notion 재점검 #3):
`LAST_TRANSIT`은 놓치면 택시비·하루 손실이고 **복구 불가**라 1,
`LAST_ENTRY`는 다음날 재방문이 가능하니 3,
`PAYMENT_WALL`은 **현장에서 즉시 차단**되므로 3이 아니라 2다.

**모든 params에 `"placeId": str(slot["place_id"])`를 넣는다** (FFE #5 — `str()` 필수).

**NULL 가드 형태** (6종 전부 동일):

```python
    if slot["cash_only"] is None:      # 미조사 — 개입을 만들지 않는다(FFE #1)
        return None
    if not slot["cash_only"]:
        return None
```

`is None`과 falsy를 **반드시 분리**한다. `if not slot["cash_only"]`만 쓰면 미조사와 "현금전용 아님"이 같아진다.

## 6. `_RULES_DURING` 순서

`_select`가 `min(priority)`이고 **동점이면 리스트 순서가 이긴다**. 15종이 되므로 명시적으로 정한다:

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

`_RULES_PRE_TRIP`은 건드리지 않는다 — 6종 전부 여행 중 규칙이다.

## 7. 테스트

규칙당 최소 4케이스 (기존 3케이스 + NULL 가드):
**발동 / 데이터 NULL(미조사) / 조건 불만족 / (위치 의존 3종) `confidence: "low"`**

파서 2개(`_hours_for`, `_break_for`)도 단독 테스트 — `weekday_overrides`·`except_weekdays`·깨진 형식.

---

# Q3 — 계약 확장

| 계층 | 파일 | 작업 |
|---|---|---|
| AI 스키마 | `ai/app/models/schemas.py` | `*Params` 6개 + `*Context` 6개 + `ProactiveContext` 유니온. **`placeId: str`** |
| AI 챗봇 | `chat_service.py:133-143` | `_INTERVENTION_GLOSS`에 6줄 |
| AI 챗봇 | `chat_service.py:148` | 새 자유 문자열을 `_FREE_TEXT_FIELDS`에 추가 (FFE #6) |
| Spring | `ProactiveIntervention.java:13-15` | `TYPE_PATTERN`에 6종 — **Spring 유일 변경점** |
| Front | `frontend/types/index.ts:248-314` | Params 인터페이스 6개 + 유니온. 전부 `placeId: string` |
| Front | `frontend/lib/proactiveText.ts` | 분기 **4개** 추가 — `LAST_TRANSIT`(`formatClockTime`) · `BREAK_TIME`·`LAST_ENTRY`(`.slice(0,5)`) · `PAYMENT_WALL`(`kind` 서브키, `WEATHER_ALERT`와 동일 형태). `CLOSED_DAY`·`RESERVATION_WALL` 2종만 `:57` 기본 경로로 자동 동작 |
| Front | `locales/{ko,en,ja,zh}.json:28` | 4개 언어 × **7키** — `PAYMENT_WALL`이 `kind` 2종(`cash_only`/`no_foreign_card`)이라 중첩 키다 |
| 문서 | `docs/04-api-spec.md` | 9종 → 15종 |

## ⚠️ 반드시 깨지는 테스트가 하나 있다

`ai/tests/test_chat_proactive_context.py:137` `test_gloss_covers_all_rule_types`가
`set(_INTERVENTION_GLOSS.keys()) == _all_rule_types()`를 검사한다.
`_all_rule_types()`(`:89-135`)는 **9종을 실제로 발동시키는 스냅샷을 하드코딩**하고 있어,
규칙 6종을 추가하면 **여기에 발동 스냅샷 6개를 추가하지 않으면 반드시 실패한다.**
의도적인 드리프트 감지 장치이므로 우회하지 말고 채운다.

---

## 검증 방법

```bash
# 단위
cd ai && ./.venv/bin/python -m pytest tests/ -q
cd backend && ./gradlew compileJava checkstyleMain checkstyleTest test
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0

# 시드 데이터 적재 (선행 — 없으면 아래가 전부 무의미)
cd ai && ./.venv/bin/python -m scripts.seed_operational_info

# 통합 — 규칙별로 해당 장소를 루트에 넣고 배너 확인
docker compose up -d --build spring fastapi
curl localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"

# FFE #1 — 운영정보가 NULL인 장소(21,000여 건 대부분)에서 개입이 안 만들어지는지
#   시드 안 된 장소만으로 루트를 만들어 조회 → 6종이 하나도 안 떠야 한다

# FFE #2 — 자정 경계
#   find_last_departure를 23:30 근처가 답이 되도록 호출하고 searchDttm의 날짜가
#   다음 날로 넘어가는지 로그로 확인

# FFE #3 — Tmap 호출 횟수
#   같은 루트를 연속 3회 조회해도 Tmap 호출이 1회뿐인지(Redis 캐시) 로그로 확인
```

---

## Self-Review 기록 (2026-08-27)

계획을 다 쓴 뒤 스펙 대조 + 플레이스홀더 + 타입 일관성 3가지를 직접 점검한 결과다.

**1. 스펙 커버리지** — 노션 「프로액티브 규칙 6종 신설」 재점검(08-18)의 7개 항목 대조:

| 재점검 항목 | 처리 |
|---|---|
| 🔴 1. dismiss 키에 placeId 없음 | **Phase B에서 해결** (서버 필터링까지 완료·검증) |
| 🔴 2. `_select` 단일 반환 + 상태형 규칙 | **Phase B에서 해결** (L2 실측 증명) |
| 🟡 3. priority 재배열 | Q2에 반영 (`LAST_TRANSIT`→1, `PAYMENT_WALL`→2, `LAST_ENTRY`→3) |
| 🟡 4. 이분탐색 캐시·날짜 경계 | Q1 FFE #2 + `_load_last_transit` 3중 가드 |
| 🟡 5. 위치 가드 기준 | Q2 규칙 표의 「위치 가드」 열 |
| 🟡 6. `break_time` JSONB 형식 | **Phase B에서 확정** (`except_weekdays`) |
| 🟢 7. `ENGLISH_UNAVAILABLE` 검토 | **범위 밖** — 노션이 "6종 완료 후 판단"으로 명시 |

누락 없음.

**2. 플레이스홀더 스캔** — `TBD|TODO|적절한 에러 처리|알아서` 등 패턴 히트 0건.
(「나중에 하면 계약을 뒤집어야 한다」류 2건은 지연이 아니라 근거 문장이라 해당 없음)

**3. 타입 일관성** — 계획서에 등장하는 식별자 10개를 대조해 **결함 2건 발견·수정**:

- ❌ `_LAST_TRANSIT_EVAL_FROM_HOUR` — 비용 방어 절에서 **쓰기만 하고 정의한 적이 없었다.**
  Q2 상수로 선언 추가
- ❌ `_load_last_transit` — 3번 언급되는데 **시그니처가 없었다.** 반환 dict 키까지 명시 추가

그 밖에 `find_last_departure`가 `leave_by`(snake)를 주고 params는 `leaveByTime`(camel)을 쓰는
불일치는 **의도된 것**이며 Interfaces 절에 근거를 남겼다(params는 i18next 보간용이라 camelCase가 규약).

**5. Q2 계획 수립 중 드러난 정정 2건 (2026-08-27)** — 상위 표에 자기모순이 있었다:

- `PAYMENT_WALL`을 「다음 슬롯 + 위치 가드 불필요」로 적었으나 **둘은 양립 불가**다.
  "다음 슬롯"은 `_current_and_next`가 주는데 그 함수 첫 줄이 `confidence != "high"` 가드다.
  → `today_slots` 순회로 변경(`RESERVATION_WALL`과 같은 형태)
- `LAST_TRANSIT`의 위치 가드를 **뺀다**. `leave_by`는 마지막 슬롯→숙소 구간에서 계산하지
  유저 현재 위치와 무관하고, 정작 필요한 밤 시간대엔 `_estimate_current_slot`의 confidence가
  낮아 **규칙이 필요한 순간에 죽는다**(챗봇 장소 추가가 "밤에 통째로 비활성"이던 것과 같은 실패 형태)

상세는 `2026-08-27-phase-c-q2-rules-impl.md`의 「상위 계획서 정정 2건」.

**4. 이 패스에서 함께 잡힌 것** — `proactiveText.ts` 분기가 원래 계획엔 **2개**로 적혀 있었으나
`PAYMENT_WALL`의 `kind` 서브키와 벽시계 시각 2종을 세면 실제로는 **4개**다. i18n 키도 6개가 아니라 7개다.
Q3 표를 정정했다.

---

## 체크리스트

**Q1**
- [ ] `search_dttm` 미전달 시 기존 동작 그대로 (`enrich_transport` 회귀 없음)
- [ ] 자정 경계에서 `yyyymmdd`가 다음 날로 넘어간다 (FFE #2)
- [ ] 경로가 아예 없으면 `None`
- [ ] `fare` 추출 — `route_slots` 저장 포맷은 바꾸지 않았다
- [ ] 이분 탐색 호출 횟수가 6회 이하

**Q2**
- [ ] 규칙 함수 안에서 `await`·DB·`datetime.now()`를 부르지 않았다 (순수 함수 원칙)
- [ ] 6종 전부 **`is None` 가드와 falsy 검사를 분리**했다 (FFE #1)
- [ ] `params["placeId"]`가 `str` (FFE #5)
- [ ] 위치 가드가 `BREAK_TIME`·`LAST_ENTRY` **2종에만** 있다 (LAST_TRANSIT엔 없다 — Q2 계획서 정정 2)
- [ ] `_RULES_DURING` 순서가 계획서대로
- [ ] `_load_slots`의 `start_time IS NOT NULL` 금지 주석을 어기지 않았다
- [ ] Tmap 3중 가드 — phase·시간·Redis 캐시

**Q3**
- [ ] `test_gloss_covers_all_rule_types`의 `_all_rule_types()`에 6개 추가
- [ ] 새 자유 문자열이 `_FREE_TEXT_FIELDS`에 들어갔다
- [ ] i18n 4개 언어 × 6키
- [ ] `docs/04-api-spec.md` 15종으로 갱신

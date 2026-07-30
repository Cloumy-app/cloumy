# 구현 계획: 프로액티브 후속 수정 — 항공편 시각 정합성 + 활성 루트 선택

**스택**: DB / Spring / FastAPI / Frontend
**예상 소요**: 5~7시간
**참조 전문가 스킬**: `postgres-expert`, `spring-expert`, `ai-expert`, `frontend-expert`
**선행**: 이슈 #143 (프로액티브 개입 엔진, `main` 머지 완료 — `0bb8b6e`)
**근거**: 2026-07-29 코드 리뷰에서 검증된 결함 10건 중 6건

> **주의**: 이 문서는 초안을 라이브러리·바이트코드 레벨로 재검증해 수정한 2판이다. 검증으로 뒤집힌 판단에는 `✅ 검증됨` / `⚠️ 초안에서 수정` 표기를 달았다.

---

## 배경 — 무엇을 왜 고치는가

프로액티브 개입 엔진(#143)은 서버 사이드 검증을 모두 통과했지만, 리뷰에서 **엔진이 아니라 엔진에 들어가는 입력이 틀어져 있는** 결함이 드러났다.

1. **항공편 시각이 계층 경계에서 어긋난다.** DB는 `TIMESTAMPTZ`, Java는 `LocalDateTime`, 프론트는 UTC ISO. 시간대 정보가 Java 계층에서만 사라진다. T1은 "출국 2시간 전 알림"인데 기준값 자체가 어긋나면 규칙이 아무리 정확해도 소용이 없다.
2. **엔진이 볼 루트를 잘못 고른다.** 홈·챗봇 모두 `display_order` 정렬 목록의 첫 항목을 활성 루트로 쓴다. `display_order`는 사용자 드래그 정렬과 "새 루트는 맨 앞" 규칙이 결정하므로 여행 날짜와 무관하다.

여기에 **오는 편 시각**을 함께 추가한다. 기존 T1 로직을 그대로 재사용할 수 있어 추가 비용이 작다.

### 용어 정리

`_AIRPORT_MINUTES = {"서울": 90, "부산": 60, "제주": 30}`가 보여주듯 대상은 국내 여행이다. "출국/입국"은 해외 여행 어휘라 부정확하므로 **가는 편(`departure_at`) / 오는 편(`return_at`)** 으로 통일한다. 기존 컬럼명은 유지하고 사용자 노출 문구만 조정한다.

---

## 전제 조건

- `main` 기준 새 브랜치 (`feat/<이슈번호>-proactive-followup-fixes`)
- Docker 스택 기동 (`cloumy-postgres-1`, `cloumy-redis-1`, `cloumy-fastapi-1`)
- **PostgreSQL 포트가 5433으로 임시 변경된 상태** — 실습 후 5432 복원 필요(별도 이슈)
- **Android 실기기/에뮬레이터 필수** — 피커 수정은 시뮬레이터만으로 검증 불가
- 재사용할 기존 구현: `_rule_flight_departure`, `formatClockTime`(`proactiveText.ts:8`), `ProactiveResponse`(래퍼 DTO 선례), `ErrorCode.INVALID_INPUT`(이미 존재)

---

## 범위

### 포함
- Java 계층 `departureAt` → `OffsetDateTime` 전환
- `routes.return_at` 컬럼 신설 + 오는 편 입력 UI + `RETURN_DEPARTURE` 규칙
- `_rule_flight_departure`를 `_RULES_PRE_TRIP`에도 등록 (새벽 항공편)
- Android 피커 2단계 분리 + 3개 부수 버그 수정
- 항공편 시각 저장·삭제 후 쿼리 캐시 반영
- `GET /v1/routes/active` 신설 + 홈·챗봇 연동
- 문서 동기화

### 제외 (의도적)
- **`RouteListResponse.createdAt`의 동일한 타입 불일치** — 표시 전용이라 체감 영향이 없고 회귀 범위가 목록·커뮤니티·탐색으로 번진다. ✅ 검증: `LocalDateTimeSerializer`는 `InstantSerializerBase`를 상속하지 않아 컨텍스트 타임존 영향을 안 받으므로, 뺀 판단이 직렬화 관점에서도 일관적이다. `unimplemented.md`에 기록.
- **배너 X 즉시 사라짐** (리뷰 4번) — 노션 실기기 기록상 재노출 방지는 정상. UX 결함이라 이번 범위에서 뺀다.
- **`proactiveContext` 신뢰 경계** (리뷰 6번) — 보안 성격이라 별건.
- **`start_time` NULL로 T2·T7 미발동** (리뷰 8번), **FREE_GAP의 now 미검사** (리뷰 10번) — 규칙 엔진 내부 로직이라 별건.
- 오는 편이 `end_date` **다음날** 새벽인 경우 — `_trip_phase`는 비용 방어의 핵심 경로(FFE #1)라 건드리는 위험이 이득보다 크다. `unimplemented.md`에 기록.

---

## 실패 시나리오 (FFE Step 1 & 2)

> **대원칙 유지**: 프로액티브는 부가 기능이다. 어떤 실패도 앱의 주 흐름을 막으면 안 되고, 모두 "개입 없음"으로 수렴한다.

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | `OffsetDateTime` 전환 후 기존 저장 데이터가 엉뚱한 시각으로 읽힘 | 전환 전 `SELECT count(*) ... WHERE departure_at IS NOT NULL` | V19가 07-27 배포라 실데이터가 사실상 없다. **먼저 0건 확인**, 0이 아니면 값을 기록해 대조 |
| 2 | `ddl-auto: validate`가 타입 변경을 거부해 부팅 실패 | Spring 부팅 로그 | ✅ 검증: Hibernate 6.5.3 + `PostgreSQLDialect.getTimeZoneSupport()=NORMALIZE`로 `OffsetDateTime`↔`timestamptz`는 기본 지원 경로다. 그래도 **실제 부팅으로 확인**한다 |
| 3 | `return_at`이 `departure_at`보다 이른 값으로 입력됨 | 서버에서 두 값 비교 | `BusinessException(ErrorCode.INVALID_INPUT, "오는 편은 가는 편보다 늦어야 합니다")` 400. `createManualRoute:196`이 이 오버로드의 선례 |
| 4 | 오는 편만 입력하고 가는 편은 미입력 | 둘 다 nullable | 각각 독립 규칙이라 문제 없음 (기존 FFE #5와 동일) |
| 5 | pre_trip에 T1을 추가해 P1 브리핑이 가려짐 | 둘 다 `priority: 1` | 등록 순서를 `[_rule_flight_departure, _rule_pre_trip_briefing]`으로 둬 T1이 이기게 한다. `_select`가 `min()`이라 동점이면 선순위가 이긴다. **의도된 동작** |
| 6 | ⚠️ **Android 다이얼로그가 취소로 안 닫힘** | 실기기에서 뒤로가기/바깥 탭 | `onDismiss`를 반드시 넘겨 step 상태를 내린다. 안 넘기면 `onDismissed()`가 no-op이고 Compose 다이얼로그는 언마운트돼야 닫힌다 |
| 7 | ⚠️ **Android 날짜가 하루 밀림** (새벽 시각) | 02:00 저장 후 재진입 시 전날 표시 | Material3 `DatePickerState`가 `initialSelectedDateMillis`를 UTC 일자로 해석한다. 날짜 단계 `value`를 **정오로 정규화**해 ±12h 안전마진 확보 |
| 8 | Android `minimumDate`가 시각 단계에 미적용 | — | ✅ 검증: `selectableDates`는 날짜 다이얼로그에만 전달되고 **일 단위로 절삭**된다. 서버 검증(#3)이 실질적 유일 방어선 |
| 9 | ⚠️ **활성 루트 없음 응답에서 `data` 키가 사라짐** | `curl` → `{"success":true}` | `ApiResponse`는 클래스 레벨 `@JsonInclude(NON_NULL)` + 전역 `non_null`. **`ApiResponse`에 `ALWAYS`를 붙이면 전 엔드포인트 회귀** — `ProactiveResponse` 선례대로 **래퍼 DTO**를 만든다 |
| 10 | active 조회 실패 시 홈 카드가 통째로 안 뜸 | `isError` | 기존 홈의 에러 + `refetch` 분기 재사용. 배너·챗봇은 개입 없음으로 수렴(기존 FFE #11) |
| 11 | ⚠️ **"지우기" 후 재진입 시 값이 되살아남** | 지우기 → 뒤로 → 재진입 | 지우기 경로에도 `setQueryData(..., departureAt: null)` 필요. 초안이 확정 경로만 다뤘다 |
| 12 | 활성 루트가 바뀌었는데 프로액티브 캐시가 이전 루트 것 | — | `['proactive', routeId]` 키가 routeId를 포함해 자동 분리. 조치 불필요 |
| 13 | 챗봇이 홈과 `['routes','list']` 캐시를 공유하는데 size가 다름(5 vs 1) | ✅ 검증: 실재하는 기존 버그 | active 전환으로 챗봇이 이 키를 떠나면서 **부수적으로 해소** |

---

## 구현 단계 (FFE Step 3 — 성공 경로)

### Part 1 — 항공편 시각 정합성

#### Step 1-1: 사전 확인 — 기존 데이터 점검

```bash
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -tAc \
  "SELECT count(*) FROM routes WHERE departure_at IS NOT NULL;"
# 기대: 0 — 0이 아니면 값을 기록하고 전환 후 대조
```

---

#### Step 1-2: `V20__add_routes_return_at.sql`

**왜 필요한가:** 오는 편 시각을 담을 자리가 없다. 코드 전체에 귀국/도착 개념이 0건이다.

```sql
-- ============================================================
-- V20: routes.return_at 컬럼 신설
-- ============================================================
BEGIN;

-- 오는 편 출발 일시(선택 입력) — 프로액티브 귀가 준비 알림(RETURN_DEPARTURE)의 기준값.
-- departure_at과 대칭. NULL 허용: 미입력 시 해당 규칙만 동작 안 한다.
ALTER TABLE routes ADD COLUMN return_at TIMESTAMPTZ;

-- 활성 루트 조회(GET /v1/routes/active)가 user_id + 날짜 범위로 필터한다.
-- 기존 idx_routes_user는 (user_id, created_at DESC)라 start_date 범위 검색을 못 탄다.
CREATE INDEX idx_routes_user_start_date ON routes (user_id, start_date);

COMMIT;
```

**주의사항:** ✅ 검증 — 기존 인덱스는 `idx_routes_user (user_id, created_at DESC)` / `idx_routes_public` / `idx_routes_tags`. 신설 인덱스와 이름·컬럼 충돌 없음. 구분선을 `BEGIN;` 위에 두는 V19 스타일을 따른다.

---

#### Step 1-3: Java 계층 `OffsetDateTime` 전환 + `returnAt`

**왜 필요한가:** DB(`TIMESTAMPTZ`)와 프론트(UTC ISO) 사이에서 Java만 시간대를 버린다.

✅ **검증 — Hibernate 추가 설정 불필요.** Spring Boot 3.3.5 / Hibernate 6.5.3. `PostgreSQLDialect.getTimeZoneSupport()`가 `NORMALIZE`를 반환하므로 `OffsetDateTime` ↔ `timestamptz`는 기본 지원 경로다. `@JdbcTypeCode`나 `hibernate.timezone.default_storage` 설정이 필요 없다.

✅ **검증 — 응답은 환경과 무관하게 `+09:00`으로 나온다.** `OffsetDateTimeSerializer`는 `InstantSerializerBase`를 상속하고, `WRITE_DATES_WITH_CONTEXT_TIME_ZONE` 기본값이 `true`이며 `spring.jackson.time-zone: Asia/Seoul`이 설정돼 있다. 따라서 `ISO_OFFSET_DATE_TIME.withZone(Asia/Seoul)`로 포맷된다. **도커 컨테이너는 TZ 미설정(UTC), 개발 맥은 KST인데 Jackson이 그 차이를 흡수한다.**

**변경 대상:**

| 파일 | 변경 |
|---|---|
| `Route.java:72-73, 103-104` | `departureAt` → `OffsetDateTime`, `returnAt` 필드 + `updateReturnAt` |
| `UpdateDepartureRequest.java:7` | `OffsetDateTime` |
| `UpdateReturnRequest.java` | 🆕 (`@NotNull` 없음 — 지우기도 유효) |
| `RouteListResponse.java:16` | 타입 변경 + `returnAt` 추가 |
| `RouteService.java:65` | 시그니처 변경 |
| `RouteService.java:43, 56, 184, 218, 268` | ⚠️ **`new RouteListResponse(...)` 5곳** (초안은 3곳으로 잘못 셈) |
| `RouteController.java` | `PATCH /routes/{routeId}/return` 추가 |

```java
// Route.java
@Column(name = "departure_at")
private OffsetDateTime departureAt;

// 오는 편 출발 일시(선택 입력) — RETURN_DEPARTURE 규칙의 기준값. departure_at과 대칭.
@Column(name = "return_at")
private OffsetDateTime returnAt;
```

```java
// RouteService.java
@Transactional
public void updateReturnAt(UUID routeId, UUID userId, OffsetDateTime returnAt) {
    Route route = findOwned(routeId, userId);
    // 오는 편이 가는 편보다 이르면 사용자 실수다 — 알림 시각이 과거로 계산돼 영원히 안 뜬다
    if (returnAt != null && route.getDepartureAt() != null
            && returnAt.isBefore(route.getDepartureAt())) {
        throw new BusinessException(ErrorCode.INVALID_INPUT, "오는 편은 가는 편보다 늦어야 합니다");
    }
    route.updateReturnAt(returnAt);
}
```

**주의사항:**
- ⚠️ **`toListResponse` 헬퍼 추출의 이득이 초안 예상보다 크다 (5곳 → 1곳).** `createManualRoute:218-219`는 `isPublic` 자리에 리터럴 `true`를 쓰는데, `saved.updateVisibility(true)` 직후라 `saved.isPublic()`으로 대체 가능하다.
- ⚠️ **`findOwned` 추출 근거도 더 강하다.** 소유권 검증 블록이 `:54, :69, :125, :160, :239, :253` **6곳**에 흩어져 있다. 단 `:160`(cloneRoute)은 `isPublic` 검사라 성격이 다르고 `:253`(reorderRoutes)은 루프 안이므로, **실제 치환 대상은 `:54, :69, :125, :239` 4곳**이다.
- ✅ `ErrorCode.INVALID_INPUT`은 **이미 존재**한다(enum 추가 불필요).
- `RouteService.java:23`의 `import java.time.LocalDateTime;`은 다른 용처가 없으면 제거.
- Java 테스트에 `departureAt` 참조 0건. AI 쪽은 asyncpg 경유라 영향 없음.

---

#### Step 1-4: AI — `RETURN_DEPARTURE` 규칙 + T1 pre_trip 등록

**왜 필요한가:** (1) 오는 편 규칙이 없다. (2) 새벽 항공편은 leave_by가 D-1로 넘어가는데 T1이 `_RULES_DURING`에만 있어 평가조차 안 된다.

```python
# chat_service.py:127 — _load_route SELECT에 return_at 추가
"SELECT id, destination, start_date, end_date, nights, departure_at, return_at "
"FROM routes WHERE id = $1 AND user_id = $2"
```

```python
# proactive_service.py — 가는 편/오는 편이 같은 계산이므로 헬퍼로 뽑는다
def _flight_leave_by(snap: dict, at_key: str) -> datetime | None:
    """항공편 출발 시각에서 '집을 나서야 하는 시각'을 역산한다. 미입력이면 None."""
    at = snap["route"][at_key]
    if at is None:
        return None  # FFE #5 — 선택 입력이라 미입력이면 해당 규칙만 스킵
    airport_minutes = _AIRPORT_MINUTES.get(snap["route"]["destination"], _AIRPORT_MINUTES_DEFAULT)
    return at - timedelta(minutes=airport_minutes + _CHECKIN_BUFFER_MIN)


def _rule_return_departure(snap: dict) -> dict | None:
    """오는 편 준비 — T1과 대칭. 여행 마지막 날 공항으로 나서야 할 시점을 알린다."""
    leave_by = _flight_leave_by(snap, "return_at")
    if leave_by is None:
        return None
    minutes_left = (leave_by - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _FLIGHT_WINDOW_MIN):
        return None
    return {
        "type": "RETURN_DEPARTURE", "priority": 1,
        "params": {"returnAt": snap["route"]["return_at"].isoformat(),
                   "leaveByTime": leave_by.isoformat()},
    }
```

```python
# 등록 — pre_trip에도 T1을 넣되 P1보다 앞에 둔다(FFE #5)
_RULES_PRE_TRIP = [_rule_flight_departure, _rule_pre_trip_briefing]
_RULES_DURING = [
    _rule_flight_departure, _rule_return_departure, _rule_departure_soon,
    _rule_empty_day, _rule_weather_alert, _rule_budget_over,
    _rule_bookmark_nearby, _rule_free_gap,
]
```

**주의사항:**
- `_rule_flight_departure`(`:139-156`)도 `_flight_leave_by`를 쓰도록 리팩터링. 로직이 두 벌 되면 임계값 수정이 한쪽만 반영된다.
- 0~60분 창을 `_FLIGHT_WINDOW_MIN = 60` 상수로 뽑아 임계 상수 블록(`:22-36`)에 둔다.
- 규칙 함수는 순수 함수 규약 유지 — `datetime.now()`/DB/네트워크 금지.

---

#### Step 1-5: AI 단위 테스트

`ai/tests/test_proactive_rules.py`에 추가 (기존 `_base_*_snap` 팩토리 재사용, `return_at` 받도록 확장):
- `test_return_departure_fires_within_window`
- `test_return_departure_none_when_not_set`
- `test_return_departure_none_when_window_passed`
- `test_flight_departure_fires_in_pre_trip_phase` — 새벽 항공편 회귀 방지
- `test_pre_trip_briefing_loses_to_flight_departure` — 동점 우선순위 고정

---

#### Step 1-6: 프론트 — 피커 (Android 2단계 + 부수 버그 3건)

**왜 필요한가:** ⚠️ 검증 결과 초안이 파악한 것보다 문제가 크다. Android에서는 **커스텀 bottom sheet 안에 Material3 다이얼로그가 겹쳐 뜨는 이중 UI**이고, 취소가 안 닫히며, 새벽 시각은 날짜가 하루 밀린다.

✅ **검증 — prop 조합만으로 해결하는 방법은 없다.** `@expo/ui@56.0.18`의 `DateTimePicker.android.tsx`에 `case 'datetime': // Android has no inline datetime picker — fall back to date only.`가 명시돼 있고, 네이티브 Kotlin(`DatePickerView.kt:43`)에도 `DATE_AND_TIME("dateAndTime") // not supported at the moment` 주석이 있다. `@react-native-community/datetimepicker`는 **미설치**(설치 시 prebuild 필요). **2단계 분리가 폴백이 아니라 유일 해법이다.**

✅ **검증 — 시각 단계가 날짜를 보존한다.** `ExpoTimePickerDialogContent`(`DatePickerView.kt:355-362`)가 `initialDate`의 `Calendar`에 시/분만 덮어쓴다. 2단계 방식이 성립한다.

```tsx
type PickerStep = null | 'date' | 'time';
const [step, setStep] = useState<PickerStep>(null);
const [draft, setDraft] = useState<Date>(new Date());

// 피커를 열 때 저장된 값으로 초기화한다 — new Date()로 두면 재저장 시 현재 시각으로 덮어쓴다
const openPicker = () => {
  setDraft(departureAt ?? new Date());
  setStep(Platform.OS === 'android' ? 'date' : 'ios');
};

{Platform.OS === 'android' && step === 'date' && (
  <DateTimePicker
    // Material3는 이 값을 UTC 일자로 해석한다 — 정오로 정규화해 새벽 시각의 하루 밀림을 막는다
    value={atNoon(draft)}
    mode="date"
    minimumDate={new Date()}
    onDismiss={() => setStep(null)}   // ← 없으면 다이얼로그가 안 닫힌다
    onValueChange={(_, picked) => {
      const next = new Date(draft);
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      setDraft(next);
      setStep('time');                 // 언마운트 → 재마운트로 단계 전환
    }}
  />
)}

{Platform.OS === 'android' && step === 'time' && (
  <DateTimePicker
    value={draft}                      // 날짜 파트가 보존된다(Kotlin :355-362)
    mode="time" is24Hour
    onDismiss={() => setStep(null)}
    onValueChange={(_, picked) => { setStep(null); commitDeparture(picked); }}
  />
)}
```
- `atNoon(d)`: `const x = new Date(d); x.setHours(12, 0, 0, 0); return x;`
- **iOS는 기존 `<Modal>` + `mode="datetime"` spinner + 확인 버튼을 그대로 둔다.**
- Android 다이얼로그는 **`<Modal>` 밖에서** 렌더한다 — 이중 UI를 없앤다.
- 가는 편/오는 편 두 벌이 생기므로 **로컬 컴포넌트로 추출**하고 `openPicker`/`commit` 콜백만 주입받게 한다.

---

#### Step 1-7: 프론트 — 캐시 반영

**왜 필요한가:** `['route', routeId]` 쿼리의 `enabled`가 `currentRoute?.id !== routeId`라 `setCurrentRoute` 실행 후 **영구히 false**가 된다. 재조회가 안 되므로 stale 캐시가 로컬 상태를 덮어쓴다.

`queryClient`는 이미 선언돼 있다(`:6` import, `:47` `useQueryClient()`). 추가 import 불필요.

```tsx
const commitDeparture = async (next: Date | null) => {
  if (!routeId) return;
  const prev = departureAt;
  setDepartureAt(next);
  const iso = next ? next.toISOString() : null;
  // 캐시도 같이 옮긴다 — 없으면 재진입 시 enabled:false라 재조회가 안 돼 옛 값이 되살아난다
  queryClient.setQueryData(['route', routeId], (old: RouteListItem | undefined) =>
    old ? { ...old, departureAt: iso } : old);
  try {
    await updateRouteDeparture(routeId, iso);
    queryClient.invalidateQueries({ queryKey: ['routes'] });
  } catch {
    setDepartureAt(prev);
    queryClient.invalidateQueries({ queryKey: ['route', routeId] });
  }
};
```

**주의사항:** ⚠️ **"지우기" 경로(`:543-561`)도 같은 함수를 타야 한다.** 초안은 확정 경로만 다뤘는데, 지우기에서 `setQueryData`를 빼면 지운 뒤 재진입 시 값이 되살아난다. 위처럼 `next: Date | null` 하나로 통합하면 두 경로가 자동으로 일치한다.

---

#### Step 1-8: 프론트 — 타입 · API · i18n

```typescript
// types/index.ts — RouteListItem
// 오는 편 출발 일시(선택 입력) — RETURN_DEPARTURE 규칙 전제. 미입력이면 null
returnAt: string | null;

// ProactiveIntervention 유니온
| { type: 'RETURN_DEPARTURE'; params: ReturnDepartureParams }
```
```typescript
// lib/api/routes.ts — updateRouteDeparture와 동일 형태
export async function updateRouteReturn(routeId: string, returnAt: string | null): Promise<void>
```
```json
// ko.json proactive 섹션
"RETURN_DEPARTURE": "돌아가는 날이에요! {{leaveByTime}}까지는 공항으로 출발하세요."
// routeResult 섹션 — 기존 departureLabel 문구도 조정
"departureLabel": "가는 편 일시",
"returnLabel": "오는 편 일시",
"returnHint": "설정하면 귀가 준비 알림을 받을 수 있어요 (선택)",
"returnClear": "오는 편 일시 지우기"
```

**주의사항:**
- **4개 locale(ko/en/ja/zh) 전부** 동시 추가. 하나라도 빠지면 그 언어에서 키가 그대로 노출된다.
- ✅ 검증 — `proactiveText.ts:8`의 `formatClockTime`이 이미 `FLIGHT_DEPARTURE`의 `leaveByTime`을 시각 포맷으로 변환한다(`:45`). **기존 버그 없음.** `RETURN_DEPARTURE`도 같은 분기 형태로 추가하기만 하면 된다.

---

### Part 2 — 활성 루트 선택

#### Step 2-1: 백엔드 — `GET /v1/routes/active`

**왜 필요한가:** "지금 도와줄 여행이 무엇인가"는 판정 로직이다. 지금은 그 판정이 없고 목록 정렬에 우연히 의존한다. 클라이언트 계산은 페이지 크기(홈 5건/챗 1건) 밖의 루트를 놓친다.

✅ **검증 — 경로 충돌 없다.** 초안의 우려는 근거가 없었다. 저장소에 동일 형태 선례가 이미 있고 프로덕션에서 동작 중이다: `PlaceController`의 `@GetMapping("/{placeId}")` vs `@GetMapping("/search")`, `RouteController`의 `@GetMapping("/routes/{routeId}")`(`:72`) vs `@GetMapping("/routes/public")`(`:135`). Spring Boot 3.3.5는 `PathPatternParser`가 기본이고 `LiteralPathElement.getScore()=0` < `CaptureVariablePathElement.getScore()=1`이라 리터럴이 항상 이긴다. **선언 순서와도 무관하다.**

```java
// RouteRepository.java
// 오늘이 여행 기간에 걸치는 루트. 겹치는 게 여러 개면 먼저 시작한 것이 진행 중인 여행이다.
@Query("SELECT r FROM Route r WHERE r.userId = :userId "
     + "AND r.startDate <= :today AND r.endDate >= :today ORDER BY r.startDate ASC")
List<Route> findOngoing(@Param("userId") UUID userId, @Param("today") LocalDate today, Pageable pageable);

// 아직 시작 안 한 것 중 가장 가까운 것. D-1 브리핑(P1)이 이 경로로 잡힌다.
@Query("SELECT r FROM Route r WHERE r.userId = :userId "
     + "AND r.startDate > :today ORDER BY r.startDate ASC")
List<Route> findUpcoming(@Param("userId") UUID userId, @Param("today") LocalDate today, Pageable pageable);
```
```java
// RouteService.java — 진행 중이 있으면 두 번째 쿼리를 아예 실행하지 않는다
public ActiveRouteResponse getActiveRoute(UUID userId) {
    LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));  // AI의 _KST와 같은 이유로 명시
    Pageable one = PageRequest.of(0, 1);
    List<Route> ongoing = routeRepository.findOngoing(userId, today, one);
    List<Route> found = ongoing.isEmpty() ? routeRepository.findUpcoming(userId, today, one) : ongoing;
    return new ActiveRouteResponse(found.isEmpty() ? null : toListResponse(found.get(0)));
}
```
```java
// trip/dto/ActiveRouteResponse.java — ProactiveResponse와 같은 이유로 ALWAYS
// 활성 루트가 없을 때 route: null을 명시 노출한다(전역 non_null 설정을 덮는다).
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ActiveRouteResponse(RouteListResponse route) {}
```
```java
// RouteController.java
@GetMapping("/routes/active")
public ApiResponse<ActiveRouteResponse> getActiveRoute(@AuthenticationPrincipal CloudmyUserDetails user) {
    return ApiResponse.ok(routeService.getActiveRoute(UUID.fromString(user.userId())));
}
```

**주의사항:**
- ⚠️ **`ApiResponse`에 `@JsonInclude(ALWAYS)`를 붙이면 안 된다.** `ApiResponse`는 클래스 레벨 `@JsonInclude(NON_NULL)`이고 전역 설정도 `non_null`이다. 여기에 `ALWAYS`를 붙이면 **전 엔드포인트**의 성공 응답에 `"error":null`이, 에러 응답에 `"data":null`이 붙는다. `ProactiveResponse` 선례를 정확히 따라 **래퍼 DTO**에 붙인다. 응답 형태는 `{"success":true,"data":{"route":null}}`.
- `today`는 KST 명시. `LocalDate.now()`는 JVM 존 의존이고 도커 컨테이너는 UTC다.

---

#### Step 2-2: 프론트 — 홈·챗봇이 같은 활성 루트를 쓰게

```typescript
// lib/api/routes.ts — 활성 루트가 없으면 null
export async function getActiveRoute(): Promise<RouteListItem | null> {
  const res = await apiFetch('/v1/routes/active');
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: { route: RouteListItem | null } } = await res.json();
  return body.data.route;
}
```
```tsx
// app/(tabs)/index.tsx — display_order 첫 항목 대신 서버 판정을 쓴다
const { data: activeRoute, isLoading, isError, refetch } = useQuery({
  queryKey: ['routes', 'active'], queryFn: getActiveRoute, staleTime: 1000 * 60 * 2,
});
```
```tsx
// app/(tabs)/chat.tsx — getMyRoutes(0,1) 제거, 같은 키 공유
const { data: activeRoute } = useQuery({
  queryKey: ['routes', 'active'], queryFn: getActiveRoute, staleTime: 1000 * 60 * 2,
});
useEffect(() => {
  if (activeRoute) setActiveRouteId(activeRoute.id);
}, [activeRoute, setActiveRouteId]);
```

**주의사항:**
- 홈이 `getMyRoutes(0, 5)`를 다른 용도로도 쓰는지 확인 후 제거.
- ✅ 챗봇이 `['routes','list']`를 떠나면서 **size 불일치 캐시 공유 버그가 부수적으로 해소**된다(홈 5건 vs 챗 1건).
- 활성 루트가 없으면 홈은 `EmptyTripCard`, 챗봇은 기존 `if (!activeRouteId)` 빈 상태로 자연히 수렴한다.

---

#### Step 2-3: 문서 동기화

루트 `CLAUDE.md`에 "API 변경 시 `docs/04-api-spec.md` 동기화 필수"가 명시돼 있다.

- `docs/04-api-spec.md` — `GET /routes/active`, `PATCH /routes/{routeId}/return` 추가. `GET /routes` **응답 바디 예시 신설**(현재 없음). `PATCH .../departure` 예시의 `"2026-07-28T09:30:00"`을 오프셋 포함으로 수정.
- `docs/03-data-model.md` — routes 표에 `departure_at`, `return_at`, `display_order` 추가(V12 이후가 통째로 누락).
- `docs/06-ai-chatbot.md` — `RETURN_DEPARTURE` 규칙 추가.
- `planning/milestones.md` — 후속 수정 항목 기록(부분 완료라 항목에만 날짜 표기).
- `planning/unimplemented.md` — 범위 제외 항목 기록.

---

## 검증 방법

```bash
# 1. 사전 — 기존 데이터
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -tAc \
  "SELECT count(*) FROM routes WHERE departure_at IS NOT NULL;"   # 기대: 0

# 2. 마이그레이션 + 부팅(ddl-auto: validate 통과 확인 — FFE #2)
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -tAc \
  "select version, description, success from flyway_schema_history order by installed_rank desc limit 1;"
# 기대: 20|add routes return at|t

# 3. 시간대 왕복 — 핵심 검증
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"departureAt":"2026-08-01T01:00:00.000Z"}' "http://localhost:8080/v1/routes/$RID/departure"
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -tAc \
  "SELECT departure_at FROM routes WHERE id='$RID';"
# 기대: 2026-08-01 10:00:00+09   (UTC 01:00 = KST 10:00 — 어긋남 없어야 한다)
curl -H "Authorization: Bearer $JWT" "http://localhost:8080/v1/routes/$RID" | jq .data.departureAt
# 기대: "2026-08-01T10:00:00+09:00"

# 4. 오는 편 순서 검증 (FFE #3)
curl -X PATCH ... -d '{"returnAt":"2026-07-30T00:00:00.000Z"}' ".../return"
# 기대: HTTP 400 + {"success":false,"error":{"code":"INVALID_INPUT",...}}

# 5. 규칙 단위 테스트
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q   # 기대: 35 passed

# 6. RETURN_DEPARTURE 발동 — return_at = now + 240분, 여행 마지막 날
curl -H "X-Internal-Key: $KEY" "http://localhost:8000/ai/proactive?user_id=$UID&route_id=$RID"
# 기대: {"intervention":{"type":"RETURN_DEPARTURE",...}}

# 7. 새벽 항공편 T1 (리뷰 9번 회귀) — D-1 + departure_at = 내일 02:00
# 기대: FLIGHT_DEPARTURE   (PRE_TRIP_BRIEFING이 아니어야 한다)

# 8. 활성 루트 — 진행 중 루트를 display_order 맨 뒤로 보낸 상태에서
curl -H "Authorization: Bearer $JWT" "http://localhost:8080/v1/routes/active" | jq .data.route.id
# 기대: 오늘 진행 중인 루트 id (목록 첫 항목이 아니어야 한다)

# 9. 활성 루트 없음 (FFE #9)
# 기대: {"success":true,"data":{"route":null}}   — "route" 키가 사라지면 안 된다

# 10. 회귀
cd ai && .venv/bin/python -m pytest -q            # 기대: 126 passed
cd backend && ./gradlew compileJava -q            # 기대: EXIT=0
cd frontend && ./node_modules/.bin/tsc --noEmit   # 기대: 소스 에러 0

# 11. FFE — FastAPI 중지 상태에서도 앱 정상 (기존 보장 유지)
docker stop cloumy-fastapi-1
curl -H "Authorization: Bearer $JWT" "http://localhost:8080/v1/routes/$RID/proactive"
# 기대: {"success":true,"data":{"intervention":null}}  HTTP 200
```

### 실기기 확인 (자동화 불가 — 수동 조작, **Android 필수**)

| 항목 | 방법 | 기대 |
|---|---|---|
| **Android 시각 입력** | 가는 편 피커 열기 | 날짜 다이얼로그 → 시각 다이얼로그 2단계, **이중 UI 없음** |
| **Android 취소** (FFE #6) | 날짜 단계에서 뒤로가기 | 다이얼로그가 닫히고 값 변경 없음 |
| **Android 새벽 시각** (FFE #7) | 02:00 저장 → 재진입 → 피커 열기 | 날짜가 **하루 밀리지 않음** |
| 저장 후 재진입 | 시각 저장 → 뒤로 → 재진입 | 저장한 값이 그대로 보임 |
| 재저장 안전성 | 재진입 후 피커 열기 | 초기값이 현재 시각이 아니라 **저장된 값** |
| **지우기 후 재진입** (FFE #11) | 지우기 → 뒤로 → 재진입 | 값이 되살아나지 않음 |
| 활성 루트 | 진행 중 여행을 목록 맨 아래로 드래그 → 홈 진입 | 배너·카드가 **진행 중 여행** 기준 |
| 챗봇 일치 | 위 상태에서 챗봇 탭 직접 진입 | 홈 배너와 같은 루트·같은 개입 |

---

## 체크리스트

**Part 1 — 항공편 시각**
- [x] 기존 `departure_at` 데이터 0건 확인
- [x] `V20__add_routes_return_at.sql` (컬럼 + 인덱스)
- [x] Java 계층 `OffsetDateTime` 전환 + 부팅 확인(`ddl-auto: validate`)
- [x] `UpdateReturnRequest` + `PATCH /routes/{routeId}/return` + 순서 검증
- [x] `toListResponse` 헬퍼 추출 (**5곳**) / `findOwned` 헬퍼 추출 (**4곳**)
- [x] `_flight_leave_by` 헬퍼 + `_rule_return_departure`
- [x] `_rule_flight_departure`를 `_RULES_PRE_TRIP`에 등록 (P1보다 앞)
- [x] `_load_route` SELECT에 `return_at`
- [x] AI 단위 테스트 5종
- [x] Android 2단계 피커 (`onDismiss` + 정오 정규화 + Modal 밖 렌더)
- [x] `commitDeparture` 통합 (확정·지우기 두 경로 모두 `setQueryData`)
- [x] 피커 로컬 컴포넌트 추출 (가는 편/오는 편 공유)
- [x] 타입/API/i18n 4개 언어

**Part 2 — 활성 루트**
- [x] `findOngoing` / `findUpcoming` 쿼리
- [x] `ActiveRouteResponse` 래퍼 DTO (`@JsonInclude(ALWAYS)`)
- [x] `getActiveRoute` 서비스 + `GET /v1/routes/active`
- [x] 홈·챗봇 활성 루트 연동

**공통**
- [x] 실패 시나리오 13건 처리 확인
- [x] 검증 명령 11종
- [ ] **실기기 8항목 — Android 기기 없어 미실행** (`planning/unimplemented.md` 🟠 섹션에 기록)
- [x] 문서 4종 + planning 2종 동기화
- [x] 노션 태스크 완료 처리

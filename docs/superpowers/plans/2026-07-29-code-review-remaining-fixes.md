# 코드 리뷰 미해결 결함 수정 — 누적 기록

2026-07-29 코드 리뷰에서 검증된 결함 10건 중, 항공편 시각·활성 루트 수정(`2026-07-29-proactive-followup-fixes.md`)에서 제외한 것들을 **하나씩** 고친다. 결함마다 계획 → 수정 → 검증 → 기록을 이 문서에 이어 붙인다.

**대상**: 4건 (배너 X 리렌더 건은 사용자 판단으로 제외)
**브랜치**: `feat/proactive-followup-fixes` (기존 5건은 `750492d`~`4ebf387`로 커밋 완료)

## 진행 현황

| # | 결함 | 상태 |
|---|---|---|
| 1 | `FREE_GAP`이 현재 시각을 안 봄 | ✅ 완료 (2026-07-29) |
| 2 | `start_time` NULL 슬롯과 `_current_and_next`의 비대칭 | ✅ 완료 — 결함 아님으로 판명 (2026-07-29) |
| 3 | 챗봇 자동 개입이 세션 내내 막힘 | ✅ 완료 (2026-07-29) — 실기기 확인 미완 |
| 4 | `proactiveContext` 무검증 시스템 프롬프트 삽입 | ⬜ 대기 |

---

# 결함 1 — `FREE_GAP`이 현재 시각을 안 본다

## 문제

`ai/app/services/proactive_service.py`의 `_rule_free_gap`이 **계획상 공백만 계산하고 `snap["now"]`를 한 번도 읽지 않는다.** 같은 파일의 `_rule_departure_soon`이 `now`를 쓰는 것과 대조된다.

여기에 `_estimate_current_slot`(`chat_service.py:172-176`)의 동작이 겹친다 — 첫 일정 시작 전이면 **시간 제한 없이** `slots[0]`을 `confidence: "high"`로 잡는다. 첫 일정이 10:00인데 새벽 3시에 열어도 high다.

### 재현

슬롯이 `10:00 시작(60분, 이동 10분)` → `13:00`인 Day에서 **08:00**에 앱을 연다.

1. `_estimate_current_slot` → `high`, current = 10:00 슬롯 (첫 일정 전이므로 `slots[0]`)
2. `current_end = 11:00`, `next_start = 13:00` → `gap = 120분`
3. `threshold = 10 + 60 = 70` → `120 ≥ 70`이라 **발동**
4. 배너: "다음 일정까지 120분 여유가 있어요. 근처 카페 어때요?"

유저는 **첫 일정을 시작조차 안 했는데** 여유가 있다는 안내를 받는다. 게다가 배너를 보면 `dismissToday`가 찍혀, **정작 실제 공백인 11:00~13:00에는 배너가 안 뜬다.** 하루치 개입 기회를 잘못된 안내로 소모한다.

### 두 번째 문제 — 안내하는 숫자도 틀리다

now가 공백 한가운데(12:00)여도 `gapMinutes`는 계획상 전체 공백인 120분을 그대로 보고한다. 실제 남은 여유는 60분이다. i18n 문구가 "다음 일정까지 {{gapMinutes}}분 여유가 있어요"라 **남은 시간을 말해야 맞다.**

## 수정 방향

`_rule_free_gap`이 "계획상 공백"이 아니라 **"지금 남은 여유"** 를 보게 한다. 가드와 계산을 한 번에 바꾼다.

```python
# 계획상 공백이 아니라 '지금 남은 여유'를 본다 — now가 공백 안에 있어야 하고,
# 안내하는 분량도 지금부터 다음 일정까지여야 한다. 계획상 공백을 그대로 쓰면
# 첫 일정 시작 전에도 발동하고(그날 dismiss를 소모한다), 공백 한가운데서는
# 이미 지나간 시간까지 여유로 세어 과대 안내가 된다.
if not (current_end <= snap["now"] < next_start):
    return None
gap_minutes = (next_start - snap["now"]).total_seconds() / 60
```

`threshold`(`transport_minutes + 60`) 비교는 **남은 시간** 기준으로 한다. 임계값의 의미가 "다음 장소까지 이동하고도 60분 여유가 남는가"이므로 남은 시간에 적용하는 게 맞다.

`_combine`이 `snap["today_date"]`와 합쳐 KST aware datetime을 만들고 `snap["now"]`도 `datetime.now(_KST)`라 **추가 변환 없이 직접 비교된다.**

### 왜 가드만 추가하지 않는가

가드만 넣으면 첫 일정 전 오발동은 막히지만, 공백 한가운데서 과대 안내하는 문제가 남는다. 두 문제의 뿌리가 같으므로(계획 시각만 보고 현재를 안 봄) 함께 고친다.

## 영향 범위

- `_rule_free_gap` 함수 내부만 변경. 다른 규칙·스냅샷 수집 경로는 건드리지 않는다.
- **기존 T7 테스트 2개가 반드시 깨진다** — `test_free_gap_fires_when_gap_exceeds_threshold`, `test_free_gap_none_when_gap_within_threshold`의 스냅샷에 `now` 키가 없다. 테스트를 갱신해 `now`를 명시한다(`snap.get("now")` 가드로 우회하면 결함을 숨기게 된다).
- `gapMinutes` 의미가 "계획상 공백" → "남은 여유"로 바뀐다. **의도된 동작 변경**이며 i18n 문구와 오히려 일치한다.

## 검증

```bash
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q   # 기대: 38 passed (35 + 신규 3)
cd ai && .venv/bin/python -m pytest -q                                  # 기대: 129 passed
```

추가할 테스트:
- `test_free_gap_none_when_now_before_gap` — 이 결함의 회귀 방지(08:00, 공백 11:00~13:00)
- `test_free_gap_none_when_now_after_gap` — 다음 일정이 이미 시작된 경우
- `test_free_gap_reports_remaining_not_planned_gap` — 공백 한가운데서 남은 시간을 보고하는지

## 수정 결과 ✅

**변경 파일**

| 파일 | 변경 |
|---|---|
| `ai/app/services/proactive_service.py` | `_rule_free_gap`에 `current_end <= now < next_start` 가드 추가, `gap_minutes`를 `next_start - now`(남은 여유)로 변경. 독스트링도 "현재 슬롯 종료 후" → "지금 다음 슬롯까지 남은 여유"로 |
| `ai/tests/test_proactive_rules.py` | `_free_gap_snap(now_hm, next_hm)` 팩토리 헬퍼 신설 — 기존 인라인 dict 2벌을 대체하고 신규 3종이 재사용. 테스트 2 → 5 |

**계획과 다른 점**: 없음. 다만 테스트를 쓰면서 기존 인라인 스냅샷 2개가 `now`만 다른 중복이 되어 `_free_gap_snap` 팩토리로 묶었다(계획엔 없던 정리).

**검증**

```bash
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q
# → 38 passed in 3.73s        (기대 38: 기존 35 + 신규 3)

cd ai && .venv/bin/python -m pytest -q
# → 129 passed in 38.91s      (기대 129: 기존 126 + 신규 3)
```

`snap["now"]`가 실제 경로에 항상 존재하는지 확인 — `_build_snapshot`이 진입 시점에 `snap: dict = {"route": route, "now": now}`로 채운다(`proactive_service.py:455`). T1·RETURN·T2·T3도 같은 키를 쓰므로 `KeyError` 위험 없음.

**남은 것**: 없음. 순수 함수라 단위 테스트가 동작을 완전히 덮는다.

---

# 결함 2 — `start_time` NULL 슬롯과 `_current_and_next`의 비대칭

**스택**: AI (FastAPI)
**예상 소요**: 30분
**참조 전문가 스킬**: `ai-expert`
**결론**: ⚠️ **동작 변경 없음.** 리뷰가 결함이라고 본 동작이 실제로는 올바르다. 회귀 방지 테스트와 주석만 추가한다.

## 리뷰의 주장

`proactive_service._load_slots`는 `start_time` 필터 없이 전 슬롯을 가져오는데(`:335-342`) `chat_service._estimate_current_slot`은 `start_time IS NOT NULL`인 슬롯만 본다(`chat_service.py:154`). `_current_and_next`가 next를 `today_slots[idx + 1]` 위치로 고르므로(`:446`) 그 자리가 시간 미입력 슬롯이면 T2·T7이 스킵된다 → "시간 미입력 슬롯이 하나만 끼어도 여행 내내 개입을 못 받는다."

## 조사로 드러난 것 — 주장이 두 겹으로 틀렸다

### (1) 현재 도달 경로가 없다

`route_slots.start_time`이 NULL이 되는 경로는 Java 5곳뿐이다(`ai/`에는 route_slots 쓰기가 전혀 없다).

| 경로 | 결과 |
|---|---|
| `createManualSlots` (`RouteSlotService.java:245-257`) | **Day 전체 NULL** — 주석에 "시간·비용·이동정보는 스코프 밖이라 전부 null" |
| `cloneSlots` (`:223-241`) | 원본 그대로 복사 — 수동 루트를 가져오면 Day 전체 NULL |
| `RouteSlot.createFixed` (`RouteSlot.java:87-98`) | 고정 슬롯. `applyFixedSlotResult`를 못 받으면 NULL로 잔존 |
| `insertSlotAfter` | 같은 트랜잭션에서 `recomputeStartTimesForDay` 호출 → NULL 안 남음 |
| `saveStreamingSlot` | AI `_assign_start_times`가 항상 채워 보냄 |

- **Day 전체가 NULL이면** `_estimate_current_slot`의 `slots`가 비어 `{"confidence": "low"}`를 반환한다(`chat_service.py:158-159`). `_current_and_next`가 즉시 `(None, None)`을 돌려주므로 **T2·T6·T7이 애초에 스킵된다. 결함이 발현되지 않는다.**
- **결함이 터지려면 하루 안에 NULL과 non-NULL이 섞여야** 한다. 확인된 유일한 경로는 미적용 고정 슬롯인데, 그 슬롯의 `order_index`는 임시값 `100_000+`(`RouteSlotService.java:170`)라 `ORDER BY order_index`에서 **항상 그날 맨 뒤**로 간다.
- 즉 리뷰가 예시로 든 `[10:00 A, (미입력) B, 14:00 C]`처럼 **중간에 NULL이 끼는 상태를 만드는 코드 경로가 없다.**

### (2) 설령 섞여도 "건너뛰기"는 오답이다

`transport_to_next` / `transport_minutes`는 **그 슬롯에서 바로 다음 슬롯까지의** 이동시간이다. `_rule_departure_soon`이 `leave_by = next_start - current["transport_minutes"]`로 쓰는 것이 그 의미를 확정한다(`:199`).

`[10:00 A (→B 10분), (NULL) B, 14:00 C]`에서 B를 건너뛰고 C를 next로 잡으면:

```
leave_by = 14:00 - 10분 = 13:50
```

10분은 **A→B** 이동시간이지 A→C가 아니다. 실제로는 B를 거쳐 가야 하므로 훨씬 일찍 나서야 한다. **틀린 시각으로 알림을 띄우는 것보다 안 띄우는 게 낫다** — 그게 지금 동작이다.

T7도 같다. `threshold = transport_minutes + 60`이 건너뛴 목적지와 맞지 않는다.

### 결론

`next_slot["start_time"] is None`일 때 규칙을 스킵하는 현재 동작(`:193-194`, `:290-291`의 FFE #8 가드)은 **의도된 안전 동작이고 올바르다.** 고칠 코드가 없다.

## 그럼 무엇을 하는가

진짜 위험은 **다음 사람이 이 비대칭을 보고 "버그다" 하며 NULL 건너뛰기를 구현하는 것**이다. 실제로 이번 리뷰가 그렇게 판단했고, 나도 `unimplemented.md`에 "`_load_slots`에 필터 추가"라고 잘못 적었다. 그 오답을 코드에 못박아 둔다.

## 실패 시나리오 (FFE)

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | 미래에 누가 `_current_and_next`에서 NULL 슬롯을 건너뛰도록 "고친다" | 회귀 테스트가 깨진다 | `test_current_and_next_does_not_skip_untimed_slot`이 "next는 바로 다음 슬롯이어야 하고 그게 NULL이면 NULL인 채로 넘어간다"를 고정 |
| 2 | 미래에 누가 `_load_slots`에 `start_time IS NOT NULL` 필터를 넣는다 | `_rule_empty_day`·`_rule_weather_alert` 테스트가 깨진다 | 그 위험을 `_load_slots` 주석에 명시. 현재 `today_slots`를 읽는 곳은 `_rule_empty_day`(`:219`)·`_rule_weather_alert`(`:239`)·`_current_and_next`(`:481`) 셋 |
| 3 | 테스트가 `asyncpg.Record` 대신 dict를 써서 실제와 어긋난다 | — | `_current_and_next`는 `s["order_index"]` 같은 키 서브스크립트만 쓰므로 dict로 충분하다. 새 fixture·mock 불필요 |

## 구현 단계

### Step 1: `_current_and_next` 회귀 테스트 3종

**왜 필요한가:** 이 함수는 현재 **테스트가 하나도 없다**(`ai/tests/` 전체 grep 0건). 동작을 고정해두지 않으면 "고쳐야 할 버그"로 오인되기 쉽다.

```python
def _slot(order_index, start_time, place_name="장소", transport_minutes=10):
    """_current_and_next는 키 서브스크립트만 쓰므로 asyncpg.Record 대신 dict로 충분하다."""
    return {
        "order_index": order_index, "start_time": start_time, "place_name": place_name,
        "duration_minutes": 60, "transport_to_next": "transit", "transport_minutes": transport_minutes,
    }


def test_current_and_next_does_not_skip_untimed_slot():
    """시간 미입력 슬롯을 건너뛰고 그 다음을 next로 잡으면 안 된다.

    transport_minutes는 '바로 다음 슬롯까지'의 이동시간이라, 건너뛴 목적지에
    적용하면 leave_by가 틀린다. 시각을 모르는 채 알림을 띄우느니 안 띄우는 게 낫다 —
    T2·T7의 FFE #8 가드가 그 판단이다."""
```

**무엇을 검증하는가**
- `test_current_and_next_does_not_skip_untimed_slot` — `[A(10:00), B(None), C(14:00)]`에서 A가 current면 next는 **B**여야 하고 `start_time`이 `None`이어야 한다(C가 아니다)
- `test_current_and_next_none_when_confidence_low` — `confidence != "high"`면 `(None, None)`
- `test_current_and_next_none_for_last_slot` — 마지막 슬롯이면 next가 `None`

### Step 2: 비대칭을 코드에 명시

**왜 필요한가:** 두 쿼리가 다른 목록을 본다는 사실이 어디에도 적혀 있지 않다.

- `_current_and_next` 독스트링에 "next는 **바로 다음** 슬롯이다. 시간 미입력이면 그대로 넘겨 규칙이 스킵하게 둔다 — 건너뛰면 `transport_minutes`가 목적지와 안 맞는다" 추가
- `_load_slots` 주석에 "`start_time` 필터를 넣지 말 것 — `_rule_empty_day`의 슬롯 카운트와 `_rule_weather_alert`의 실외 카운트가 함께 망가진다" 추가

### Step 3: 기록 정정

`planning/unimplemented.md`의 해당 항목을 **"미해결 결함" → "확인 결과 정상 동작"** 으로 바꾼다. 지금 적혀 있는 "`_current_and_next`가 다음 슬롯을 고를 때 `start_time`이 있는 것 중 첫 번째를 찾도록 수정" 지시는 **오답이므로 지운다.**

## 검증

```bash
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q
# 기대: 41 passed  (38 + 신규 3)

cd ai && .venv/bin/python -m pytest -q
# 기대: 132 passed
```

## 체크리스트

- [x] `_slot` 헬퍼 + `_current_and_next` 회귀 테스트 3종
- [x] `_current_and_next` 독스트링에 "건너뛰지 않는다"와 그 이유 명시
- [x] `_load_slots` 주석에 "필터 금지" 경고 + 영향받는 규칙 3곳 명시
- [x] `unimplemented.md` 항목을 정상 동작으로 정정, 오답 지시 삭제
- [x] 테스트 통과 확인

## 수정 결과 ✅ — 동작 변경 없음

**변경 파일**

| 파일 | 변경 |
|---|---|
| `ai/tests/test_proactive_rules.py` | `_slot` 헬퍼 + `_current_and_next` 테스트 3종. 섹션 주석에 "왜 이 동작을 못박는가"(리뷰가 오판한 이력 포함) 기록 |
| `ai/app/services/proactive_service.py` | `_current_and_next` 독스트링에 "next는 바로 다음 슬롯이며 건너뛰지 않는다" + `transport_minutes` 근거. `_load_slots`에 "필터 금지" 경고 + 영향받는 규칙 3곳 |
| `planning/unimplemented.md` | 항목을 취소선 + "확인 결과 정상 동작"으로 정정. 내가 적었던 오답 지시("`start_time` 있는 첫 슬롯을 찾도록 수정")를 근거와 함께 폐기 |

**로직 변경 0줄.** `_rule_departure_soon`·`_rule_free_gap`·`_current_and_next`·`_load_slots` 어느 것도 동작이 바뀌지 않았다.

**검증**

```bash
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q
# → 41 passed in 11.19s       (기대 41: 38 + 신규 3)

cd ai && .venv/bin/python -m pytest -q
# → 132 passed in 58.91s      (기대 132: 129 + 신규 3)
```

**이 결정에서 배운 것**

리뷰가 "코드 A와 코드 B가 서로 다른 가정을 한다"는 **구조적 비대칭**을 정확히 찾아냈지만, 그것이 **런타임에 도달 가능한가**와 **고치면 더 나아지는가**는 별개였다. 두 질문을 따로 확인하지 않으면 멀쩡한 안전 동작을 "버그"로 바꿔 실제 회귀를 만든다. 특히 `_load_slots`에 필터를 넣는 안은 T3·T4를 망가뜨렸을 것이다.

---

# 결함 3 — 챗봇 자동 개입이 한 번 대화하면 세션 내내 막힌다

**스택**: Frontend
**예상 소요**: 40분
**참조 전문가 스킬**: `frontend-expert`

## 문제

`frontend/app/(tabs)/chat.tsx:156`의 자동 개입 가드가 전역 `useChatStore.messages` 길이만 본다.

```tsx
if (messages.length > 0) return;
```

이 배열은 **루트별로 분리되지도, 화면 이탈 시 초기화되지도 않는다.** `setActiveRouteId`는 `activeRouteId`만 바꾸고 `messages`는 그대로 두며(`useChatStore.ts:24`), `reset()`은 저장소 어디에서도 호출되지 않는다(전수 grep 0건).

### 증상 ① — 한 번 대화하면 그 세션 내내 자동 개입이 안 된다

챗봇에서 아무 질문이나 하면 `messages.length > 0`이 되고 다시 0으로 돌아갈 방법이 없다. 여행 당일 아침에 챗봇 탭에 들어와도 가드에 걸려 `seedFromProactive`가 실행되지 않는다. **2026-07-28에 추가한 "챗봇 직접 진입 자동 개입"이 첫 대화 이후 사실상 죽는다.**

### 증상 ② — 무관한 대화 끝에 개입이 붙는다

반대로 루트를 바꿔도 `messages`가 남아 있어, 어제 도쿄 여행 대화 끝에 오늘 부산 여행의 개입 말풍선이 맥락 없이 끼어든다.

### 가드의 두 목적 중 하나는 이미 중복이다

`:154-155` 주석은 가드의 목적을 둘로 적고 있다.

1. 대화가 진행 중일 때 끼어들지 않는다
2. 배너를 탭해 들어온 경우를 걸러낸다(배너가 이미 같은 말풍선을 넣었다)

**목적 2는 `isDismissedToday`가 이미 처리한다.** `ProactiveBanner.handleTap`이 `dismissToday`를 **먼저** 호출하고 `seedFromProactive` → `router.push('/chat')` 순서로 진행하므로(`ProactiveBanner.tsx:31-36`), 챗 화면이 마운트될 때 `:157`의 `isDismissedToday` 검사에서 이미 걸린다. 즉 `messages.length > 0`은 목적 2에 대해 잉여다.

남는 건 목적 1인데, 그것을 **"전역 대화가 비어 있는가"** 로 구현한 게 결함의 원인이다. 올바른 질문은 **"지금 이 루트의 대화가 진행 중인가"** 다.

## 수정 방향 — 대화를 루트에 귀속시킨다

가드를 없애는 게 아니라, 가드가 **참조하는 상태를 올바른 범위로** 만든다.

### (1) `setActiveRouteId`가 루트 전환 시 대화를 비운다

```ts
// 대화는 루트에 귀속된다 — 다른 여행으로 바뀌면 이전 대화는 맥락이 아니라 잡음이다.
// 같은 routeId로 다시 호출되는 경우(쿼리 refetch)에는 건드리지 않는다. 안 그러면
// 화면에 머무는 동안 대화가 통째로 날아간다.
setActiveRouteId: (routeId) =>
  set((s) =>
    s.activeRouteId === routeId
      ? { activeRouteId: routeId }
      : { activeRouteId: routeId, messages: [], pendingProactive: null },
  ),
```

### (2) `seedFromProactive`가 `routeId`도 받아 함께 세팅한다

**(1)만 넣으면 배너 → 챗봇 인계가 깨진다.** 순서를 보면 명확하다.

| 순서 | 상태 |
|---|---|
| 홈에서 배너 탭 | `activeRouteId`는 아직 `null`(챗을 연 적 없으면) |
| `seedFromProactive` | `messages`에 말풍선 1개 추가 |
| `/chat` 진입 → 쿼리 resolve → `setActiveRouteId(routeId)` | `null → routeId`는 **변경**이므로 (1)이 방금 넣은 말풍선을 지운다 ❌ |

배너는 자기가 어느 루트를 위해 씨를 뿌리는지 알고 있으므로(`ProactiveBanner`의 `routeId` prop) 함께 넘긴다.

```ts
seedFromProactive: (routeId, type, params, text) =>
  set((s) => ({
    // 씨를 뿌리는 시점에 루트도 함께 확정한다 — 그래야 챗 화면이 마운트되며
    // setActiveRouteId를 불러도 '같은 루트'로 판정돼 말풍선이 살아남는다.
    activeRouteId: routeId,
    messages: [
      ...(s.activeRouteId === routeId ? s.messages : []),
      { id: `${Date.now()}-proactive`, role: 'assistant', content: text, createdAt: new Date() },
    ],
    pendingProactive: { type, params, text },
  })),
```

### (3) 가드는 그대로 두되 주석을 사실에 맞게 고친다

`messages`가 루트에 귀속되면 `messages.length > 0`은 **"지금 이 루트의 대화가 진행 중"** 이라는 정확한 의미가 된다. 코드는 그대로, 주석만 고친다.

### 남는 구멍 — 의도적으로 남긴다

같은 루트 · 같은 앱 세션에서 **사용자가 먼저 말을 건 뒤**에는 자동 개입이 안 뜬다. 다만 이건 손실이 아니다.

- Zustand에 persist가 없어 앱을 재시작하면 `messages`가 비고 다시 뜬다
- **홈 배너는 독립적으로 계속 뜬다**(`isDismissedToday`만 본다) — 개입 자체가 사라지지 않는다
- "대화 중 끼어들지 않는다"는 원래 의도를 지키는 쪽이다

가드를 아예 제거하는 안도 검토했으나, 사용자가 메시지를 보내는 중에 개입 말풍선이 끼어들어 순서가 어색해질 수 있어 채택하지 않았다.

## 실패 시나리오 (FFE)

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | **배너가 뿌린 말풍선이 챗 마운트 시 지워짐** | 실기기: 배너 탭 → 챗 진입 시 말풍선 없음 | (2)로 `seedFromProactive`가 `activeRouteId`를 함께 세팅 → 같은 루트로 판정돼 살아남음 |
| 2 | 쿼리 refetch가 같은 routeId를 돌려줘 대화가 날아감 | 실기기: 챗에 머무는 동안 대화 사라짐 | `s.activeRouteId === routeId`일 때는 `messages`를 건드리지 않음 |
| 3 | `pendingProactive`가 살아남아 엉뚱한 루트 메시지에 실림 | 서버 로그의 `proactive_context` | 루트 전환 시 `messages`와 함께 `pendingProactive`도 비움 |
| 4 | 활성 루트가 없어 `activeRouteId`가 `null`이 됨 | — | `null → routeId`는 변경으로 처리(대화 비움). 최초 진입 시엔 어차피 비어 있어 무해 |
| 5 | `getActiveRoute` 실패로 `activeRoute`가 `undefined` | `isError` | `if (activeRoute)` 가드가 이미 있어 `setActiveRouteId` 자체가 호출되지 않음 — 기존 대화 유지 |

## 구현 단계

### Step 1: `frontend/stores/useChatStore.ts`

- `seedFromProactive` 시그니처에 `routeId: string` 추가 (첫 번째 인자)
- `seedFromProactive`가 `activeRouteId`를 함께 세팅, 다른 루트면 `messages`를 갈아엎고 시작
- `setActiveRouteId`가 루트 **변경 시에만** `messages`·`pendingProactive` 초기화
- 인터페이스 주석에 "대화는 루트에 귀속된다" 명시

### Step 2: `frontend/components/route/ProactiveBanner.tsx`

`handleTap`의 `seedFromProactive` 호출에 `routeId` 전달.

### Step 3: `frontend/app/(tabs)/chat.tsx`

- 자동 개입 `seedFromProactive` 호출에 `activeRouteId` 전달
- `:154-155` 주석을 사실에 맞게 교체 — "전역 대화"가 아니라 "이 루트의 대화"이고, 배너 탭 케이스는 `isDismissedToday`가 거른다는 점 명시

## 검증

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
# 기대: 소스 에러 0 (tsconfig.json:6 baseUrl deprecated 경고 1건은 기존 이슈)
```

프론트엔드에는 테스트 러너가 없다(`package.json`에 test 스크립트·jest·vitest 모두 없음). 동작 확인은 실기기 수동 조작이다.

| 항목 | 방법 | 기대 |
|---|---|---|
| **증상 ① 회귀** | 챗봇에서 아무 질문 → 홈 → 루트 전환 → 챗봇 재진입 | 새 루트의 개입 말풍선이 뜬다 |
| **증상 ② 회귀** | 루트 A 대화 후 루트 B로 전환 → 챗봇 | A의 대화가 남아 있지 않다 |
| **FFE #1 (가장 중요)** | 앱 재시작 → 홈 배너 탭 → 챗 진입 | 배너와 같은 말풍선이 **1개** 보인다(0개도 2개도 아님) |
| FFE #2 | 챗봇에 머문 채 2분 대기(쿼리 refetch) | 대화가 사라지지 않는다 |
| 맥락 인계 | 배너 탭 → 첫 메시지 전송 | 서버 로그에 `proactive_context`가 실린다 |

## 체크리스트

- [x] `useChatStore.setActiveRouteId` 루트 변경 시에만 대화 초기화
- [x] `useChatStore.seedFromProactive`에 `routeId` 추가 + `activeRouteId` 동시 세팅
- [x] `ProactiveBanner.handleTap` 호출부 갱신
- [x] `chat.tsx` 호출부 갱신 + 가드 주석 사실화
- [x] `tsc --noEmit` 통과
- [ ] 실기기 5항목 (특히 FFE #1 배너 인계) — **미완**

## 수정 결과 ✅ (실기기 확인 미완)

**변경 파일**

| 파일 | 변경 |
|---|---|
| `frontend/stores/useChatStore.ts` | `setActiveRouteId`가 루트 **변경 시에만** `messages`·`pendingProactive` 초기화. `seedFromProactive`가 `routeId`를 받아 `activeRouteId`를 함께 확정. 인터페이스에 "대화는 루트에 귀속된다" 주석 |
| `frontend/components/route/ProactiveBanner.tsx` | `handleTap`의 `seedFromProactive` 호출에 `routeId` 전달 |
| `frontend/app/(tabs)/chat.tsx` | 자동 개입 호출에 `activeRouteId` 전달. 가드 주석을 사실에 맞게 교체 — 두 목적을 뭉쳐 적던 것을 "이 루트의 대화" 가드와 "배너 탭은 `isDismissedToday`가 거른다"로 분리 |

**계획과 다른 점**: 없음.

**검증**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
# → tsconfig.json(6,5) baseUrl deprecated 경고 1건(기존 이슈), 소스 에러 0
```

`seedFromProactive` 호출부 전수 확인 — `ProactiveBanner.tsx:34`, `chat.tsx:163` 둘뿐이며 모두 갱신됨.

**FFE #1 흐름 검증 (코드 추적)**

| 순서 | 스토어 상태 |
|---|---|
| 앱 시작 | `activeRouteId: null`, `messages: []` |
| 배너 탭 → `seedFromProactive(R, ...)` | `null ≠ R`이라 messages를 새로 시작 → 말풍선 **1개**, `activeRouteId: R` |
| 챗 마운트 → `setActiveRouteId(R)` | `s.activeRouteId === R` → messages 손대지 않음 → 말풍선 **1개 유지** ✓ |
| 자동 개입 effect | `messages.length > 0`에서 return, `isDismissedToday`도 true → 중복 없음 ✓ |

**남은 것 — 실기기 확인 5항목.** 이 수정은 화면 전환·마운트 타이밍에 의존하므로 코드 추적만으로는 부족하다. 특히 FFE #1(배너 탭 → 챗 진입 시 말풍선이 0개도 2개도 아닌 정확히 1개)이 이 변경에서 가장 깨지기 쉬운 지점이다.

# 코드 리뷰 미해결 결함 수정 — 누적 기록

2026-07-29 코드 리뷰에서 검증된 결함 10건 중, 항공편 시각·활성 루트 수정(`2026-07-29-proactive-followup-fixes.md`)에서 제외한 것들을 **하나씩** 고친다. 결함마다 계획 → 수정 → 검증 → 기록을 이 문서에 이어 붙인다.

**대상**: 4건 (배너 X 리렌더 건은 사용자 판단으로 제외)
**브랜치**: `feat/proactive-followup-fixes` (기존 5건은 `750492d`~`4ebf387`로 커밋 완료)

## 진행 현황

| # | 결함 | 상태 |
|---|---|---|
| 1 | `FREE_GAP`이 현재 시각을 안 봄 | ✅ 완료 (2026-07-29) |
| 2 | `start_time` NULL 슬롯과 `_current_and_next`의 비대칭 | ✅ 완료 — 결함 아님으로 판명 (2026-07-29) |
| 3 | 챗봇 자동 개입이 세션 내내 막힘 | ⬜ 대기 |
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

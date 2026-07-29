# 코드 리뷰 미해결 결함 수정 — 누적 기록

2026-07-29 코드 리뷰에서 검증된 결함 10건 중, 항공편 시각·활성 루트 수정(`2026-07-29-proactive-followup-fixes.md`)에서 제외한 것들을 **하나씩** 고친다. 결함마다 계획 → 수정 → 검증 → 기록을 이 문서에 이어 붙인다.

**대상**: 4건 (배너 X 리렌더 건은 사용자 판단으로 제외)
**브랜치**: `feat/proactive-followup-fixes` (기존 5건은 `750492d`~`4ebf387`로 커밋 완료)

## 진행 현황

| # | 결함 | 상태 |
|---|---|---|
| 1 | `FREE_GAP`이 현재 시각을 안 봄 | ✅ 완료 (2026-07-29) |
| 2 | `start_time` NULL 슬롯과 `_current_and_next`의 비대칭 | ⬜ 대기 |
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

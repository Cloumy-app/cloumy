# 구현 계획: 챗봇 추천 장소를 루트에 추가하기 — 삽입 위치를 대화에서 정한다

**작성일**: 2026-07-29
**스택**: FastAPI + Spring + Frontend (3스택 전부)
**예상 소요**: 4~5시간
**참조 전문가 스킬**: `fastapi-expert`, `spring-expert`, `frontend-expert`, `karpathy-guidelines`

---

## 0. 문제 정의

실기기에서 사용자가 발견: **챗봇이 추천한 장소 카드를 눌러도 아무 일도 일어나지 않는다.**

기능이 없는 게 아니다. `frontend/app/(tabs)/chat.tsx:37`:

```ts
const canInsert = !!estimatedSlot;                       // ← 이게 null이면
disabled={!canInsert || added || insertingId !== null}   // ← 카드 전체가 죽는다
```

`estimatedSlot`은 서버의 `insertion_anchor`이고, `_estimate_current_slot`의 **시간 기반 위치
추정이 `high`일 때만** 채워진다. 발견 시각 23:30은 Day 1 마지막 일정(20:25+60분)이 끝난
뒤라 `low`로 떨어졌고, `+` 아이콘도 안내 문구도 숨겨진 채 **눌리지 않는 목록**이 됐다.

### 진짜 원인은 "삽입 위치를 무엇으로 정하는가"

```java
public record InsertSlotRequest(
        @NotNull UUID afterSlotId,   // ← "어느 슬롯 뒤에"가 필수
        @NotNull UUID placeId,
        String reason
) {}
```

삽입은 반드시 기준 슬롯이 필요한데, 챗봇이 가진 기준점은 "지금 있을 법한 슬롯" **하나뿐**이다.
추정이 실패하면 넣을 자리가 없다. 그런데 **"내일 뭐 할까" 같은 계획성 대화는 대부분 밤에
한다** — 기능이 가장 필요한 시간대에 정확히 죽는다.

### 방향 전환 (사용자 결정)

> "여행 일정 중에 어디 가기 전에 어디 들리고 싶어~ 이런식이면 그 중간에 넣고,
> 아니면 아예 새로운 곳을 찾을 때는 언제 추가하고 싶은지 물어보는 게 좋을 것 같은데"
> "맥락 없으면 일단 너가 먼저 추천해주는 건 어때, 이날 가시는 걸까요? 이런 식으로"

즉 삽입 위치는 **GPS·시각이 아니라 대화에서** 나와야 하고, 대화에도 없으면 **챗봇이 먼저
제안**하고 사용자가 확인한다. 이러면 "맥락 있으면 원탭 / 없으면 피커"라는 두 갈래가
**"항상 제안하고 확인받기" 하나로 합쳐진다.**

---

## 1. 설계

### 1-1. 서버는 자리를 정하고, 문구는 앱이 만든다

프로액티브 엔진에서 확립한 원칙(**"판단은 규칙이, 표현은 앱이"**)을 그대로 쓴다.
서버 응답에 한국어를 넣지 않는다 — 4개 언어 문구는 앱 i18n이 만든다.

```
insertion: {
  day: int,                    # 몇 일차
  afterSlotId: str | null,     # null = 그 Day 맨 앞
  source: "conversation" | "estimated" | "default"
}
```

`source`로 앱이 문구를 고른다:
- `conversation` — "말씀하신 대로 **경복궁 앞에** 추가할까요?"
- `estimated` — "지금 계신 **경복궁 다음에** 추가할까요?"
- `default` — "**2일차 마지막에** 추가할까요?"

장소명("경복궁")은 **앱이 슬롯 캐시에서 `afterSlotId`로 찾아 붙인다.** 서버가 이름을
내려주면 그게 또 자유 문자열 통로가 된다(결함 4에서 없앤 것과 같은 문제).

### 1-2. 자리를 정하는 우선순위 — 3단

| 순위 | 근거 | `source` | 언제 |
|------|------|----------|------|
| ① | **대화 맥락** — 모델이 넘긴 힌트를 서버가 슬롯으로 해석 | `conversation` | "경복궁 가기 전에", "2일차에" |
| ② | **위치 추정** — `_estimate_current_slot`이 `high`면 그 슬롯 다음 | `estimated` | 낮에 여행 중 (**기존 동작 그대로**) |
| ③ | **규칙 기본값** — 오늘 Day 맨 뒤, 오늘이 여행 밖이면 1일차 맨 뒤 | `default` | 밤·여행 전 (지금 죽는 구간) |

②가 기존 동작과 **정확히 같다**는 게 중요하다 — 낮의 원탭 경험이 회귀하지 않는다.
`estimated_slot`은 없애지 않고 **①이 비었을 때의 입력**으로 재활용한다.

### 1-3. 모델이 힌트를 넘기는 통로 — 도구를 늘리지 않는다

`search_nearby_places`의 입력에 선택 인자를 더한다. 4번째 도구를 만들지 않는 이유는
숙소 연동 때와 같다(토큰 증가 + "언제 부를지" 판단 실패가 이미 실측됨).

```python
"insert_day": {"type": "integer", "description": "사용자가 '2일차에'처럼 날짜를 지정했으면 그 숫자."},
"insert_before_place": {"type": "string", "description": "'경복궁 가기 전에'처럼 특정 장소 앞을 지정했으면 그 장소명."},
"insert_after_place": {"type": "string", "description": "'경복궁 다음에'처럼 특정 장소 뒤를 지정했으면 그 장소명."},
```

**전부 선택**이다. 아무것도 안 주면 ②→③으로 떨어진다 — 하위호환이 깨지지 않는다.

> 자유 문자열(`insert_*_place`)이 들어오지만 **시스템 프롬프트에 닿지 않는다.**
> 서버가 DB 슬롯 이름과 대조해 `slot_id`로 바꾸고 버린다. 매칭 실패하면 그냥 무시(③).
> 결함 4에서 막은 통로와 성격이 다르다.

### 1-4. `afterSlotId`를 nullable로 여는 이유

"경복궁 **가기 전에**"에서 경복궁이 그날 **첫 일정**이면 맨 앞에 넣어야 한다. 지금 API로는
불가능하다. 빈 Day도 같다. **사용자가 가장 자연스럽게 말하는 형태가 "~ 가기 전에"인데
그게 첫 일정일 때 실패하면 기능이 반쪽이 된다.**

---

## 2. 전제 조건

| 항목 | 상태 |
|------|------|
| 카드 탭→삽입 UI (`PlaceCardList`, `+`/체크/스피너) | ✅ 이미 있음 — 게이트만 풀면 됨 |
| Day 선택 UI 패턴 | ✅ `components/route/DayPickerConfirm.tsx` (직접 검색·가져오기가 씀) |
| 삽입 서비스 (order_index 밀기, 이동정보 재계산, 시각 캐스케이드) | ✅ `RouteSlotService.insertSlotAfter` |
| 슬롯 캐시 (앱이 장소명을 붙이는 근거) | ✅ `queryKey: ['route-slots', routeId]` |

---

## 3. 실패 시나리오 (FFE Step 1 & 2)

| # | 실패 상황 | 감지 | 대응 |
|---|-----------|------|------|
| 1 | 모델이 **일정에 없는 장소명**을 힌트로 줌 (환각) | 슬롯 이름 대조 실패 | 힌트 무시하고 ②→③으로 폴백. 예외 던지지 않는다 |
| 2 | **같은 이름 슬롯이 여러 Day**에 있음 | 매칭 2건 이상 | `insert_day`가 있으면 그걸로 좁히고, 없으면 **오늘 이후 첫 번째**. 결정적으로 하나 |
| 3 | `insert_day`가 **범위 밖** (0, 99) | `1 <= day <= nights+1` 위반 | 무시하고 ③. 모델 출력은 신뢰하지 않는다 |
| 4 | 루트에 **슬롯이 하나도 없음** | 슬롯 0건 | `{day: 1, afterSlotId: null}` — nullable 덕에 가능 |
| 5 | 사용자가 확인 시트에서 **빈 Day**를 고름 | 그 Day 슬롯 0건 | `afterSlotId: null`로 전송 |
| 6 | 삽입 직전 **다른 기기에서 그 슬롯이 삭제**됨 | 404 `SLOT_NOT_FOUND` | 알림 + `['route-slots']` 무효화해 최신 일정으로 다시 고르게 |
| 7 | **다른 루트의 slotId**를 보냄 | `afterSlot.routeId != routeId` | **현재 검증이 없다(아래 §3-1)** — 이번에 추가 |
| 8 | 확인 시트에서 **취소** | — | 아무것도 안 함. 카드는 그대로 |
| 9 | **같은 장소 두 번** 추가 | `addedIds` | 기존 동작 유지 — 체크 표시 후 비활성 |
| 10 | 삽입 성공했는데 **슬롯 목록 갱신 실패** | invalidate 후 refetch 오류 | 기존 동작 유지(다음 진입 시 갱신). 낙관적 갱신 안 한다 |
| 11 | `insertion`이 **null**로 내려옴 (구버전 서버) | 필드 없음 | 카드는 살리고 시트를 **빈 상태**로 띄운다 — 죽은 카드로 되돌아가지 않는다 |

### 3-1. ⚠️ 지금 발견한 검증 누락 (FFE #7)

```java
verifyOwner(routeId, userId);
RouteSlot afterSlot = routeSlotRepository.findById(afterSlotId)   // ← routeId 대조 없음
        .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
int dayNumber = afterSlot.getDayNumber();                         // ← 남의 루트 day를 씀
```

`afterSlot`이 **이 루트 소속인지 확인하지 않는다.** 다른 루트(남의 것 포함) slotId를 보내면
그 슬롯의 `dayNumber`로 내 루트에 삽입된다. 데이터가 새지는 않지만 엉뚱한 Day에 꽂힌다.
이번에 이 메서드를 고치므로 **같이 막는다** — `afterSlot.getRouteId().equals(routeId)` 아니면
`SLOT_NOT_FOUND`.

---

## 4. 구현 단계 (FFE Step 3 — 성공 경로)

### Step 1 — Spring: `afterSlotId` nullable + 루트 소속 검증

**왜 필요한가**: "첫 일정 앞"과 "빈 Day"를 표현할 방법이 없으면 ①(대화 맥락)이 자주 실패한다.

`InsertSlotRequest`:
```java
public record InsertSlotRequest(
        UUID afterSlotId,          // null이면 dayNumber 맨 앞에 삽입
        @NotNull Integer dayNumber, // afterSlotId가 null일 때 어느 Day인지 (항상 보내게 해 계약을 단순하게)
        @NotNull UUID placeId,
        String reason
) {}
```

`insertSlotAfter` — `afterSlot`을 `Optional`로 일반화:
```java
Optional<RouteSlot> afterSlot = afterSlotId == null
        ? Optional.empty()
        : Optional.of(routeSlotRepository.findById(afterSlotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND)));

// FFE #7 — 남의 루트 슬롯을 기준점으로 못 쓰게 한다
afterSlot.filter(s -> !s.getRouteId().equals(routeId))
         .ifPresent(s -> { throw new BusinessException(ErrorCode.SLOT_NOT_FOUND); });

int day = afterSlot.map(RouteSlot::getDayNumber).orElse(dayNumber);
int insertOrderIndex = afterSlot.map(s -> s.getOrderIndex() + 1).orElse(0);
int shiftFrom = afterSlot.map(RouteSlot::getOrderIndex).orElse(-1);  // 맨 앞이면 전부 민다
```

**주의**:
- 밀기 쿼리는 `OrderIndexGreaterThan(shiftFrom)` 그대로 쓴다 — `-1`이면 그 Day 전체가 대상이 되어 자연히 맞는다. **내림차순 + 건별 flush는 절대 건드리지 않는다** (UNIQUE 제약 위반 실측 기록이 주석에 있다).
- `recalculateNeighborTransport(..., prev, next)`가 이미 `Optional<RouteSlot> prev`를 받으므로 `Optional.empty()`를 그대로 넘기면 된다 — 시그니처 변경 없음.
- `dayNumber`가 여행 범위 밖이면 `INVALID_INPUT`.

---

### Step 2 — FastAPI: 삽입 자리 결정 (`chat_service.py`)

**왜 필요한가**: ①②③ 우선순위를 한 곳에 가둬야 도구와 응답이 서로 다른 자리를 말하지 않는다.

```python
async def _resolve_insertion(
    db, route, estimated_slot: dict, hint: dict,
) -> dict | None:
    """삽입 자리를 정한다. ①대화 힌트 → ②위치 추정 → ③오늘 Day 맨 뒤 순.

    한국어를 만들지 않는다 — day/afterSlotId/source만 준다. 문구는 앱 i18n이
    슬롯 캐시에서 장소명을 찾아 조립한다(프로액티브와 같은 원칙). 서버가 장소명을
    내려주면 그게 또 자유 문자열 통로가 된다."""
```

- ① `hint`의 `insert_before_place` / `insert_after_place`를 그 루트 슬롯 이름과 대조
  (정확 일치 → 부분 일치 순). `insert_day`가 있으면 그 Day로 좁힌다.
  - `before` 매칭 → 그 슬롯의 **바로 앞 슬롯**이 앵커, 첫 슬롯이면 `afterSlotId: null`
  - `after` 매칭 → 그 슬롯이 앵커
  - `insert_day`만 있으면 → 그 Day **맨 뒤**
- ② `estimated_slot["confidence"] == "high"` → `{day, afterSlotId: slot_id, "estimated"}`
- ③ 오늘 Day(범위 밖이면 1일차) 맨 뒤. 슬롯이 없으면 `afterSlotId: null`

`_tool_search_nearby_places`가 `insert_*` 입력을 **그대로 통과**시켜 `handle_chat`이
받게 한다(도구 반환에 `_insert_hint`로 얹거나, `handle_chat`이 `block.input`에서 직접 읽는다 —
후자가 도구 반환을 안 더럽혀서 낫다).

`ChatResponse`에 `insertion: Insertion | None` 추가. `estimated_slot`은 **그대로 둔다**(②의 입력).

---

### Step 3 — Spring: 응답 통과 + 요청 DTO

`ChatResponse`에 `@JsonAlias("insertion") ChatInsertion insertion` 추가 (레코드 1개 신설).
`AiServiceClient`의 응답 매핑에 필드 추가. **로직 없음 — 순수 통과.**

---

### Step 4 — Frontend: 게이트 제거 + 확인 시트

**왜 필요한가**: 사용자가 실제로 막힌 지점. `canInsert` 게이트를 없애는 게 핵심이다.

```ts
// chat.tsx — 이 한 줄이 문제의 전부였다
- const canInsert = !!estimatedSlot;
+ // 카드는 항상 누를 수 있다. 어디 넣을지는 시트에서 확인받는다 —
+ // 위치 추정 실패(저녁·밤)로 카드가 통째로 죽던 게 이 게이트 때문이었다.
```

탭 → `InsertPlaceSheet` (신규, `DayPickerConfirm` 스타일 재사용):
- 제목: `insertion.source`별 i18n 문구 + 앱이 슬롯 캐시에서 찾은 장소명
- Day 칩 (1..nights+1) — 바꾸면 그 Day 맨 뒤로 앵커 재계산
- [추가] / [취소]
- `insertion`이 null이면 Day 미선택 상태로 시작 (FFE #11)

`insertRouteSlot(routeId, afterSlotId | null, dayNumber, placeId, reason)`로 시그니처 확장.

i18n 4개 언어(`ko/en/ja/zh`) 키 추가.

---

### Step 5 — 테스트

**AI** (`ai/tests/test_chat_insertion.py`, 신규):

| 테스트 | 고정하는 것 |
|--------|-------------|
| `test_insertion_from_before_place` | "경복궁 앞" → 앞 슬롯이 앵커 |
| `test_insertion_before_first_slot_gives_null_anchor` | 첫 슬롯 앞 → `afterSlotId=None` (FFE #4의 근거) |
| `test_insertion_from_after_place` | "경복궁 뒤" → 그 슬롯이 앵커 |
| `test_insertion_unknown_place_falls_back` | 없는 장소명 → 무시하고 폴백 (FFE #1) |
| `test_insertion_ambiguous_place_picks_deterministically` | 같은 이름 2개 → 결정적 선택 (FFE #2) |
| `test_insertion_out_of_range_day_ignored` | day=99 → 무시 (FFE #3) |
| `test_insertion_uses_estimated_slot_when_no_hint` | 힌트 없고 추정 high → `source="estimated"` (기존 동작 보존) |
| `test_insertion_default_when_nothing` | 둘 다 없음 → `source="default"` |
| `test_insertion_empty_route_gives_null_anchor` | 슬롯 0건 → day=1, `afterSlotId=None` |

**Spring** — 기존 테스트 패턴 확인 후: `afterSlotId=null` 맨 앞 삽입, 다른 루트 slotId 거부(FFE #7).

---

### Step 6 — 문서 동기화

- `docs/04-api-spec.md` — `POST /routes/{id}/slots` 요청 변경(`afterSlotId` nullable, `dayNumber` 신설)
- `docs/06-ai-chatbot.md` — `search_nearby_places`의 `insert_*` 인자, `insertion` 응답 필드, 3단 우선순위
- `planning/unimplemented.md` — FFE #7(루트 소속 검증) 해결 기록

---

## 5. 검증 방법

```bash
# 1. AI 단위 테스트
cd ai && .venv/bin/python -m pytest -q
# 기대: 155 passed (146 + 신규 9)

# 2. Spring 컴파일 + 테스트
cd backend && ./gradlew compileJava test
# 기대: BUILD SUCCESSFUL

# 3. 프론트 타입체크
cd frontend && npx tsc --noEmit
# 기대: 소스 에러 0 (tsconfig baseUrl 경고만)

# 4. 맨 앞 삽입 (afterSlotId=null) — 기존엔 불가능했던 경로
curl -s -X POST http://localhost:8080/v1/routes/$RID/slots -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '{"afterSlotId":null,"dayNumber":1,"placeId":"'$PID'"}' | jq '.data[0].orderIndex'
# 기대: 0  (그리고 기존 첫 슬롯이 1로 밀림)

# 5. 다른 루트의 slotId 거부 (FFE #7)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/v1/routes/$RID/slots \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"afterSlotId":"'$OTHER_SLOT'","dayNumber":1,"placeId":"'$PID'"}'
# 기대: 404

# 6. 대화 맥락 삽입 (AI 직접 호출)
curl -s -X POST http://localhost:8000/ai/chat -H "X-Internal-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"...","route_id":"...","message":"경복궁 가기 전에 카페 들르고 싶어","language":"ko"}' \
  | jq '.insertion'
# 기대: {"day":1,"afterSlotId":null|"...","source":"conversation"}

# 7. 맥락 없음 → 기본 제안
#    message: "근처 카페 추천해줘"  (밤 시각, 추정 실패 상태)
# 기대: insertion.source == "default", day == 오늘 Day

# 8. 실기기 — 밤에 카드 탭 → 시트 → 추가 → 루트 화면에서 위치 확인
```

---

## 6. 체크리스트

- [ ] 노션 태스크 생성
- [ ] Step 1 Spring: nullable + `dayNumber` + FFE #7 검증
- [ ] Step 2 FastAPI: `_resolve_insertion` + 도구 인자 + 응답 필드
- [ ] Step 3 Spring: 응답 통과 DTO
- [ ] Step 4 Frontend: 게이트 제거 + `InsertPlaceSheet` + i18n 4개 언어
- [ ] Step 5 테스트 (AI 9건 + Spring 2건)
- [ ] Step 6 문서 3종
- [ ] FFE #1~#11 처리 확인
- [ ] 검증 1~8 실행

---

## 7. 범위 밖 (의도적 제외)

| 항목 | 왜 빼는가 |
|------|-----------|
| 삽입 취소(undo) | 요청에 없다. 루트 화면에서 삭제하면 된다 |
| 여러 장소 한 번에 추가 | 요청에 없다. 카드별 탭으로 충분 |
| 시트에서 "어느 장소 뒤" 세밀 선택 | 먼저 Day 단위로 내고 실사용을 본다. 챗봇 제안이 잘 맞으면 불필요 |
| 챗봇 답변 문장에 제안 위치 넣기 | 앱이 시트로 정확히 보여준다. 프롬프트 산문에 의존하면 흔들린다 |
| `PostgisTagRetriever` 반경 확장 문제 | 별건 — `unimplemented.md` 기록됨 |

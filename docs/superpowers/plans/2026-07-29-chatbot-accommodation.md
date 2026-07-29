# 구현 계획: 챗봇 숙소 인지 — 프로액티브 ↔ 챗봇 일관성 회복

**작성일**: 2026-07-29
**스택**: FastAPI (AI 단독 — Spring·Frontend 변경 없음)
**예상 소요**: 1.5~2시간
**참조 전문가 스킬**: `fastapi-expert`, `ai-expert`, `karpathy-guidelines`

---

## 0. 문제 정의

실기기 확인 중 발견: **"숙소 근처 카페 찾아줘"** 라고 하면 챗봇이 숙소를 되묻는다.

원인은 단순하다 — `ai/app/services/chat_service.py` 전체에 숙소 참조가 **0건**이다.

```bash
$ grep -c "accommodation\|숙소\|stay" ai/app/services/chat_service.py
0
```

도구 3개(`search_nearby_places` / `get_weather_forecast` / `get_route_status`) 중
`accommodations` 테이블을 읽는 것이 하나도 없다. 반면 프로액티브는
`proactive_service._load_stay_distances`(`:358-375`)에서 이미 Day↔숙소 date-range
조인을 구현해 두었다. **같은 루트인데 프로액티브는 숙소를 알고 챗봇은 모른다** —
사용자가 지적한 "프로액티브랑 챗봇이랑 일관되게 보여야 하잖아"가 정확히 이 지점이다.

### 왜 "도구를 새로 만들지 않는가"

숙소 전용 도구(`get_accommodation`)를 4번째 도구로 추가하는 선택지가 있었지만 버렸다.

- 도구가 늘면 매 요청 토큰이 늘고, 모델이 "언제 부를지" 판단을 한 번 더 해야 한다.
  실측된 실패 모드가 이미 있다 — `today_day`를 프롬프트 힌트로만 주니 모델이 연결 짓지
  못하고 되물었고, **도구 결과 자체에 넣어서** 해결했다(`chat_service.py:377-382` 주석).
- 숙소는 "일정의 일부"다. `get_route_status`가 이미 Day별 일정을 반환하는데
  그날 밤 어디서 자는지만 빠져 있는 게 오히려 부자연스럽다.

→ **기존 `get_route_status` 결과에 숙소를 얹고, `search_nearby_places`에 기준점 인자를
추가한다.** 도구 개수는 3개 그대로.

---

## 1. 전제 조건

| 항목 | 상태 |
|------|------|
| `accommodations` 테이블 (route_id, name, location, check_in_date, check_out_date) | ✅ 존재 |
| Day↔숙소 date-range 조인 선례 | ✅ `proactive_service._load_stay_distances:358-375` |
| DB 대역 테스트 패턴 | ✅ `MagicMock(spec=asyncpg.Pool)` + `AsyncMock` (`tests/test_retrievers.py:8-12`) |
| 도커 컨테이너 | ✅ 기동 중 |

### ⚠️ 헬퍼는 반드시 `chat_service.py`에 둔다

`proactive_service.py:17`이 `chat_service`를 import한다. 반대 방향으로 import하면
**순환 참조**가 난다. 이번 브랜치에서 `ProactiveContext`를 `routes/chat.py`에 뒀다가
같은 이유로 `models/schemas.py`로 옮긴 전례가 있다.

---

## 2. 사전 조사 결과 — 숙소 날짜 어긋남의 정체

계획 전 확인해야 했던 미결 항목(테스트 데이터 문제인가, 입력 UI 버그인가)을 규명했다.

```
 destination | start_date |  end_date  |    name    | check_in   | check_out  | route.updated_at
 서울        | 2026-07-29 | 2026-07-31 | 남산힐호텔 | 2026-07-14 | 2026-07-16 | 2026-07-29 13:12  ← 어긋남
 서울        | 2026-07-10 | 2026-07-11 | 남산힐호텔 | 2026-07-10 | 2026-07-11 | (일치)
 서울        | 2026-07-08 | 2026-07-10 | 롯데호텔   | 2026-07-08 | 2026-07-10 | (일치)
 춘천        | 2026-07-08 | 2026-07-10 | 더잭슨    | 2026-07-08 | 2026-07-10 | (일치)
 춘천        | 2026-07-08 | 2026-07-10 | 더잭슨    | 2026-07-08 | 2026-07-10 | (일치)
```

**결론: 입력 UI 버그가 아니다.** 5건 중 4건이 루트 기간과 정확히 일치한다.
어긋난 `448c2939`는 `created_at` 07-14 / `updated_at` 07-29 13:12 — 즉 **07-14에 만든
루트의 날짜만 나중에 손으로 바꿨다**(프로액티브를 "여행 중" 상태로 테스트하려고).
`RouteController`에 루트 날짜 수정 API 자체가 없으므로(`Mapping` 전수 확인) 앱으로는
발생할 수 없다 → **테스트 데이터**.

### 다만 잠재 결함은 실재한다 (새로 발견)

`AccommodationService.create`(`:47-50`)는 `checkOut > checkIn`만 검증하고
**루트 기간과 대조하지 않는다.** 따라서 앱으로도 여행 기간 밖 숙소를 저장할 수 있고,
그러면 date-range 조인이 조용히 빈 결과를 낸다 — 지금 만들려는 기능이 정확히
그 조인 위에 서므로, **이번 설계는 조인 실패를 정상 경로로 취급해야 한다**(FFE #2).

> 이 검증 누락 자체를 고치는 건 이번 범위 밖(Spring 변경). `unimplemented.md`에 기록만 한다.

---

## 3. 실패 시나리오 (FFE Step 1 & 2)

| # | 실패 상황 | 감지 방법 | 대응 |
|---|-----------|-----------|------|
| 1 | 루트에 숙소가 **아예 없음** (등록 안 함) | `_load_accommodations` 빈 리스트 | `get_route_status.accommodations = []`, 각 day의 `accommodation = null`. `origin="accommodation"` 검색은 `{"places": [], "error": "숙소가 등록되지 않았습니다"}` → 모델이 숙소 등록을 안내하거나 위치를 되묻는다 |
| 2 | 숙소 날짜가 **여행 기간 밖** (§2의 실재 케이스) | 오늘 날짜 조인 결과 없음 | 숙소가 **정확히 1곳**이면 그걸 쓰되 `date_matched: false`를 함께 반환 → 모델이 "등록하신 남산힐호텔 기준으로" 라고 밝히고 답한다. 조용히 맞는 척하지 않는다 |
| 3 | 숙소가 **여러 곳**인데 오늘 날짜 조인 실패 | 조인 결과 없음 + `len > 1` | 특정 불가 → `error`로 되묻게 한다. 임의로 첫 번째를 고르지 않는다 |
| 4 | 같은 날짜에 숙소가 **중복 등록** (검증 없어 가능) | 조인 결과 2건 이상 | `ORDER BY check_in_date, id LIMIT 1` — 결정적으로 하나만. 요청마다 답이 바뀌는 게 최악이다 |
| 5 | 모델이 `origin`을 **안 넘김** (구버전 동작) | `tool_input.get("origin")` 없음 | 기본값 `"current"` → **기존 동작 100% 그대로**. 하위호환이 깨지지 않는다 |
| 6 | 모델이 `origin`에 **엉뚱한 값**을 넣음 | 화이트리스트 밖 | `"current"`로 폴백. 예외를 던져 대화를 끊지 않는다 |
| 7 | 숙소 기준 반경 내 장소 **0건** | `places` 빈 배열 | 기존 빈 결과 처리 그대로 (이미 처리됨) |
| 8 | `location` 컬럼이 NULL | — | 발생 불가 (`NOT NULL` 제약). 방어 코드 넣지 않는다 |
| 9 | 도구 결과가 커져 **토큰 초과** | — | 숙소는 여행당 보통 1~3건, 필드도 5개. `days` 덤프에 비하면 무시할 수준 |

---

## 4. 구현 단계 (FFE Step 3 — 성공 경로)

### Step 1 — `_load_accommodations()` 신설 (`chat_service.py`)

**왜 필요한가**: 두 도구가 같은 숙소 데이터를 쓴다. 조회를 한 곳으로 모아야
`get_route_status`와 `search_nearby_places`가 서로 다른 숙소를 말하는 일이 없다.

```python
async def _load_accommodations(db: asyncpg.Pool, route_id: str) -> list[dict]:
    """루트의 숙소 전부를 체크인 순으로. 좌표는 검색 기준점으로 바로 쓸 수 있게 (lng, lat).
    프로액티브 _load_stay_distances와 같은 테이블을 보지만, 저쪽은 '거리'만 필요해
    PostGIS 거리 계산을 하고 이쪽은 '어디인지'가 필요해 좌표·이름·날짜를 가져온다."""
    rows = await db.fetch(
        "SELECT name, check_in_date, check_out_date, "
        "ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat "
        "FROM accommodations WHERE route_id = $1 ORDER BY check_in_date, id",
        route_id,
    )
    return [ ... ]   # dict 5필드
```

**주의**: `ORDER BY check_in_date, id` — `id`까지 넣어야 같은 날짜 중복 시 순서가 고정된다(FFE #4).

---

### Step 2 — 오늘 밤 숙소 해석기 `_resolve_stay()` (`chat_service.py`)

**왜 필요한가**: FFE #2·#3의 판단 규칙이 두 도구에 흩어지면 반드시 어긋난다. 한 함수에 가둔다.

```python
def _resolve_stay(accommodations: list[dict], today: date) -> dict | None:
    """오늘 밤 묵는 숙소. 날짜로 못 정하면 '숙소가 1곳뿐일 때만' 그걸 쓰고
    date_matched=False로 표시한다 — 근거가 약하다는 걸 모델이 알아야
    '아마', '등록하신 ~ 기준으로' 같은 표현을 쓴다(시스템 프롬프트 규칙 4)."""
    for a in accommodations:
        if a["check_in_date"] <= today < a["check_out_date"]:
            return {**a, "date_matched": True}
    if len(accommodations) == 1:
        return {**accommodations[0], "date_matched": False}
    return None
```

**설계 판단**: `_estimate_current_slot`의 `day`를 쓰지 않고 **오늘 날짜를 직접** 쓴다.
슬롯 추정은 `start_time`이 있는 슬롯이 없으면 실패하는데, 숙소는 일정이 비어 있어도
정해져 있다. 불필요한 실패 의존을 만들지 않는다.

---

### Step 3 — `get_route_status`에 숙소 얹기

**왜 필요한가**: "3일차 숙소 어디였지?", "숙소 체크아웃 언제야?" 를 답할 수 있게 된다.
그리고 `search_nearby_places`가 되물어야 할 때 모델이 근거를 갖는다.

```python
accommodations = await _load_accommodations(db, route["id"])
# Day N의 날짜 = start_date + (N-1)일 — _load_stay_distances의 date-range 조인과 동일 기준
for day_dict in days.values():
    stay = _resolve_stay(accommodations, route["start_date"] + timedelta(days=day_dict["day"] - 1))
    day_dict["accommodation"] = stay["name"] if stay and stay["date_matched"] else None

return {
    ...,
    "accommodations": [{"name":…, "check_in_date":…, "check_out_date":…}, …],  # 좌표는 제외 — 모델에 불필요
    "days": [...],
}
```

**주의**: day별에는 `date_matched=True`일 때만 이름을 넣는다. 여기서 1곳 폴백까지 쓰면
"모든 Day의 숙소가 남산힐호텔"이라는 **틀린 단정**이 된다. 폴백은 검색 기준점 한정.
그래도 최상위 `accommodations`에 전체 목록이 있으므로 모델은 무엇이 등록됐는지 항상 본다.

---

### Step 4 — `search_nearby_places`에 `origin` 인자 추가

**왜 필요한가**: 사용자가 실제로 막힌 지점. 지금은 검색 중심이 GPS→추정슬롯→도시중심으로
고정돼 "숙소 근처"를 표현할 방법이 아예 없다.

도구 스키마:
```python
"origin": {
    "type": "string",
    "enum": ["current", "accommodation"],
    "description": "검색 기준점. 사용자가 '숙소 근처'/'호텔 주변'처럼 숙소를 기준으로 "
                   "물으면 'accommodation'. 그 외에는 생략(현재 위치 기준).",
}
```

실행부 — 기존 폴백 체인 위에 분기를 얹는다:
```python
if tool_input.get("origin") == "accommodation":
    stay = _resolve_stay(await _load_accommodations(db, route["id"]), datetime.now(_KST).date())
    if stay is None:
        return {"places": [], "error": "등록된 숙소가 없어 숙소 기준으로 찾을 수 없습니다."}
    center = (stay["lng"], stay["lat"])
    origin_info = {"kind": "accommodation", "name": stay["name"], "date_matched": stay["date_matched"]}
else:
    ... 기존 3단 폴백 그대로 ...
    origin_info = {"kind": "current"}
```
반환에 `"origin": origin_info` 추가 → 모델이 "남산힐호텔 근처에서 찾았어요"라고 말할 수 있다.

**주의**: `enum` 밖의 값은 `== "accommodation"` 비교에서 자연히 `else`로 떨어진다(FFE #6).
별도 검증 코드를 넣지 않는다 — 분기 자체가 화이트리스트다.

---

### Step 5 — 시스템 프롬프트 규칙 보강

규칙 3을 고치고 규칙 9를 추가한다. **규칙 3이 지금 되묻게 만드는 직접 원인**이다
("추정도 없고 사용자가 위치를 말한 적도 없다면 … 먼저 물어보세요").

```
3. search_nearby_places를 쓸 때, 사용자가 "숙소 근처"처럼 숙소를 기준으로 물으면
   origin="accommodation"으로 호출하세요 — 숙소가 어디인지 사용자에게 되묻지 마세요.
   그 외에는 [현재 위치 추정]이 있으면 그걸 기준으로 바로 호출하세요. 추정도 없고
   사용자가 위치를 말한 적도 없다면 바로 호출하지 말고 먼저 지금 어디 계신지 물어보세요.

9. 숙소 정보는 get_route_status의 accommodations와 각 day의 accommodation에 있습니다.
   숙소를 사용자에게 되묻기 전에 이 도구를 먼저 호출하세요. 검색 결과의
   origin.date_matched가 false면 그 숙소가 오늘 날짜와 맞지 않는다는 뜻이므로
   "등록하신 OO 기준으로" 처럼 근거를 밝히고 답하세요.
```

---

### Step 6 — 테스트 `tests/test_chat_accommodation.py` 신설

`MagicMock(spec=asyncpg.Pool)` + `AsyncMock` 패턴(`test_retrievers.py`)을 따른다.

| 테스트 | 고정하는 것 |
|--------|-------------|
| `test_resolve_stay_matches_by_date` | 여러 숙소 중 오늘 날짜 구간의 것을 고른다 |
| `test_resolve_stay_single_fallback_marks_unmatched` | 날짜 안 맞아도 1곳이면 쓰되 `date_matched=False` (FFE #2) |
| `test_resolve_stay_returns_none_when_ambiguous` | 여러 곳 + 날짜 불일치 → `None` (FFE #3) |
| `test_resolve_stay_returns_none_when_empty` | 숙소 없음 → `None` (FFE #1) |
| `test_route_status_marks_day_accommodation` | day별 숙소는 `date_matched` 일 때만 채워진다 |
| `test_search_origin_accommodation_uses_stay_coords` | `origin="accommodation"` 이면 숙소 좌표가 검색 중심 |
| `test_search_origin_defaults_to_current` | `origin` 생략 시 기존 폴백 체인 그대로 (FFE #5 하위호환) |
| `test_search_origin_without_accommodation_returns_error` | 숙소 없으면 error 반환, 예외 안 던짐 (FFE #1) |

---

### Step 7 — 문서 동기화

- `docs/06-ai-chatbot.md` — 4-1(`search_nearby_places`)에 `origin` 인자와 기준점 우선순위,
  4-3(`get_route_status`)에 `accommodations`/`accommodation` 필드, 참조 테이블 목록에
  `accommodations` 추가
- `planning/unimplemented.md` — 🟠 비일관성 섹션의 "챗봇 숙소 미인지" 해소 처리 +
  "숙소 날짜 어긋남"은 **테스트 데이터로 판명**(§2) 기록 + **신규**: 숙소 날짜 루트 기간 검증 누락

---

## 5. 검증 방법

```bash
# 1. 단위 테스트 — 신규 8건 포함 전체
cd ai && .venv/bin/python -m pytest -q
# 기대: 146 passed (기존 138 + 신규 8)

# 2. 테스트 루트의 숙소 날짜를 여행 기간에 맞춘다 (§2에서 테스트 데이터로 판명된 건 교정)
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c \
  "UPDATE accommodations SET check_in_date='2026-07-29', check_out_date='2026-07-31'
   WHERE route_id='448c2939-2cb3-4206-b142-36f3aaf4207e';"
# 기대: UPDATE 1

# 3. 실기기(iOS 시뮬레이터) — 챗봇에 "숙소 근처 카페 찾아줘"
# 기대: 숙소를 되묻지 않고 "남산힐호텔 근처에서 찾은 카페" + 장소 카드 5개
#       (교정 전이라면 "등록하신 남산힐호텔 기준으로" 라고 밝히고 답해야 한다)

# 4. 회귀 — "근처 카페 찾아줘" (숙소 언급 없음)
# 기대: 기존과 동일하게 현재 위치/추정 슬롯 기준으로 검색 (origin 생략 경로)

# 5. "3일차 숙소 어디야?" 
# 기대: get_route_status의 day별 accommodation으로 되묻지 않고 답변
```

---

## 6. 체크리스트

- [ ] 노션 태스크 생성/확인 (구현 전 필수)
- [ ] Step 1 `_load_accommodations`
- [ ] Step 2 `_resolve_stay`
- [ ] Step 3 `get_route_status` 숙소 필드
- [ ] Step 4 `search_nearby_places` `origin` 인자
- [ ] Step 5 시스템 프롬프트 규칙 3 수정 + 9 추가
- [ ] Step 6 테스트 8건
- [ ] Step 7 문서 동기화
- [ ] 실패 시나리오 #1~#7 처리 확인 (#8 발생 불가, #9 무시 가능)
- [ ] 검증 1~5 실행

---

## 7. 범위 밖 (의도적 제외)

| 항목 | 왜 빼는가 |
|------|-----------|
| 숙소 전용 4번째 도구 | §0 — 도구 수를 늘리지 않는 게 실측된 실패 모드를 피하는 길 |
| 숙소 날짜 ↔ 루트 기간 검증 (Spring) | 이번은 AI 단독 변경으로 끝난다. 별건으로 기록만 |
| 숙소까지의 이동시간/경로 | 프로액티브도 직선거리 근사에 그친다. 외부 API 호출이 새로 필요 |
| 프론트엔드 변경 | `last_places`·`insertion_anchor` 계약이 그대로라 불필요 |

---

## 8. 수정 결과 (2026-07-29)

### 계획대로 들어간 것

Step 1~6 전부. `_load_accommodations` / `_resolve_stay` / `get_route_status` 숙소 필드 /
`search_nearby_places` `origin` 인자 / 프롬프트 규칙 3·9 / 테스트 8건.
**pytest 146 passed** (기존 138 + 신규 8, 회귀 0).

테스트 1건은 계획보다 강화했다 — `test_search_origin_accommodation_uses_stay_coords`의
숙소 날짜를 2020년으로 두어, 실행일이 언제든 "오늘과 안 맞는 유일한 숙소"가 되게 했다.
덕분에 `date_matched=False`가 도구 반환까지 흘러나가는지를 **결정적으로** 고정한다
(원래는 실행 시각에 따라 흔들려서 그 값을 단정하지 못했다).

### 계획에 없었는데 추가로 필요했던 것 — 프롬프트 2건

**코드만 고쳤을 때 기능이 동작하지 않았다.** API 스모크 테스트 결과:

> "현재 여행 중이 아니네요. 여행이 시작되는 2026년 7월 29일에 남산힐호텔에 머무실 텐데,
> 아직 여행 중이 아니라서 정확한 위치를 알 수 없어요."

숙소 이름은 알아냈는데(= 코드 수정은 동작) **검색을 아예 안 했다.** 원인 둘:

1. **`location_hint`가 규칙 3을 이겼다.** 위치 추정 실패 시 붙는
   "위치가 필요한 질문이면 추측하지 말고 사용자에게 지금 어디 있는지 먼저 물어보세요"가
   규칙 3의 "숙소 기준이면 `origin="accommodation"`으로 호출하세요"를 눌렀다. 숙소 기준
   질문은 애초에 현재 위치가 필요 없는데도. → **`location_hint`에 숙소 예외를 같이 적어야**
   진다. 규칙 목록에만 적어두면 진다.

2. **모델이 오늘 날짜를 몰랐다.** 시스템 프롬프트에 여행 기간만 있고 "오늘"이 없어서,
   `today_day`(위치 추정 성공 시에만 채워짐)가 null이면 "여행 중이 아니다"라고 단정했다.
   테스트 시각 23:25는 마지막 일정(20:25+60분)이 끝난 뒤라 추정이 실패한 것뿐인데,
   **오늘은 실제로 Day 1이었다.** → `- 오늘: {날짜} — 여행 N일차 (여행 중)` 한 줄 추가 +
   규칙 8을 "today_day가 null인 건 지금 어느 장소에 있는지 모른다는 뜻이지 여행 중이
   아니라는 뜻이 아니다"로 고쳤다.

   이건 프로액티브와의 불일치이기도 하다 — 프로액티브는 `now`를 알고 판단하는데
   챗봇만 오늘이 언제인지 몰랐다. 밤 시간대는 **숙소 질문이 가장 많이 나올 시간대**라
   이 구멍을 안 막으면 기능이 실사용에서 대부분 안 먹는다.

**교훈**: 도구·데이터를 고쳐도 프롬프트가 막고 있으면 기능은 동작하지 않는다.
단위 테스트 146건 전부 통과한 상태에서 실패했다 — 프롬프트 상호작용은 단위 테스트로
안 잡힌다. LLM 기능은 반드시 실제 API로 한 번 쳐봐야 한다.

### 검증 결과

| 질문 | 결과 |
|------|------|
| "숙소 근처 카페 찾아줘" | ✅ 되묻지 않음. *"등록하신 남산힐호텔을 기준으로..."* + 장소 카드 5개 (`date_matched=false` 문구가 의도대로 나옴) |
| "우리 숙소 어디로 잡았더라?" | ✅ 이름·날짜 답변 + **날짜가 여행 기간과 안 맞는 것까지 스스로 지적** |
| "근처 맛집 추천해줘" (숙소 언급 없음) | ✅ 기존대로 위치를 되물음 — 회귀 없음 |
| pytest | ✅ 146 passed |

### 검증 중 발견한 별건

"숙소 근처"라고 답했는데 결과가 **연남동·강남·인천**이었다. `PostgisTagRetriever`가
후보 3건 미만이면 반경을 50km로 자동 확장하는데(`retrievers.py:76-77`) 남산힐호텔
1.5km 내 `#카페` 장소가 `places`에 0건이라 곧바로 벌어진 것. **숙소 연동이 만든 결함이
아니라 기존 동작**(현재 위치 기준 검색도 동일)이고, 리트리버는 루트 생성에서도 쓰므로
반환 형태를 바꾸면 영향 범위가 넓다 → 이번 범위에서 빼고 `unimplemented.md`에 기록.

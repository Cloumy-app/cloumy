# 챗봇 근처 검색 정확도 — 거리순 정렬 + 일정 장소 기준점

- **날짜**: 2026-07-30
- **노션**: 📍 챗봇 근처 검색 정확도 — 거리순 정렬 + 일정 장소 기준점
- **브랜치**: `fix/chat-nearby-search-accuracy`
- **범위**: `ai/` 만 (Spring·프론트 미변경)
- **선행 작업**: 챗봇 숙소 인지 (`ec73021`, `5d55564`)

---

## 0. 문제 정의

실기기 확인 중 사용자가 발견: **챗봇에 식당·카페를 물으면 "근처"가 아닌 곳이 추천된다.**

실제로 재현해 거리를 측정했다. 「숙소 근처 카페 알려줘」 (기준: 남산힐호텔):

| 추천된 카페 | 실거리 |
|---|---|
| 어차 연남점 | 5.1 km |
| 만월다방 시네마 | 5.2 km |
| 코리야 | 5.8 km |
| **BP:D 비피디 1호점** | **23.8 km** |
| **도프뮤지엄 구월** | **27.3 km** (인천 구월동) |

「근처 맛집 추천해줘」는 더 심하다 — **홍천재래식손두부 49.4 km (강원도)**, 참좋은생각 29.8 km (경기도).

### 원인 규명 — 계측으로 확정

`retrievers.py`에 진단 로그를 넣어 재현한 결과:

```
[진단] 검색 tags=['#먹방'] center=(127.079, 37.527) radius=1500m → 1차 2건
후보 2건 — 반경 1500m → 50000m 확장
[진단] 검색 tags=['#카페'] center=(126.982, 37.556) radius=1500m → 1차 0건
후보 0건 — 반경 1500m → 50000m 확장
```

**태그 어휘는 맞다** — 모델이 `#먹방`, `#카페`를 정확히 보냈고 DB에 있는 태그다. 어휘 불일치가 아니다.

| # | 원인 | 이번에 고치나 |
|---|---|---|
| ① | **데이터 분포** — `#카페` 큐레이션 장소가 전국 313건 / 서울 27건. 반경 1.5 km 안 0건이 정상 상태(루트 슬롯 6곳 전부 0건 실측). `#먹방`은 9,427건이지만 기준점별로 1.5 km 안이 2 ~ 81건 | ❌ 데이터 수집 트랙 — `unimplemented.md`에 기록 |
| ② | **폴백이 1.5 km → 50 km로 한 번에 점프** (`retrievers.py:76`) | ❌ ③을 고치면 무해해진다 |
| ③ | **거리순 정렬이 아예 없다** (`retrievers.py:45, 65`) — `ORDER BY RANDOM() LIMIT 80` 후 앞 5개. 50 km 원 안에서 무작위라 5 km와 27 km가 나란히 섞인다 | ✅ **체감 원인** |
| ④ | **일정에 있는 장소를 기준점으로 못 쓴다** — 「남산공원 근처 카페」라고 명시했는데 *"지금 어디 계신지 확인이 필요해요"* 라고 되묻는다. `origin`이 `current`/`accommodation` 둘뿐 | ✅ |

### 왜 ②를 손대지 않는가

②가 해로웠던 이유가 **전적으로 `ORDER BY RANDOM()` 때문**이다. 거리순으로 바꾸면 50 km로 확장돼도 "가장 가까운 5곳"이 나오므로 단계적 확장(3 km → 7 km → 15 km)이 불필요해진다.

잔여 문제는 "가장 가까운 카페가 5 km인데도 그냥 근처라고 말한다"는 것이고, 그건 **거리를 실어 보내 챗봇이 솔직히 말하게 하는 것**으로 풀린다 — ③과 같은 변경 덩어리다.

④는 어제 고친 숙소 인지 결함(`ec73021`)과 같은 계열이다. 숙소는 `origin=accommodation`으로 풀었지만 일정 상의 장소 기준은 여전히 없었다.

---

## 1. 설계

### 1-1. 정렬 모드를 파라미터로 — 기본값은 기존 동작

```python
sort: Literal["random", "distance"] = "random"
```

`PostgisTagRetriever` 호출부가 셋이라 전역 변경은 **회귀**가 된다:

| 호출부 | 정렬 | 왜 |
|---|---|---|
| `chat_service.py:353` 챗봇 근처 검색 | `distance` | "근처"가 목적 자질이다 |
| `slot_alternatives.py:81` 슬롯 대안 (5 km) | `distance` | 인접 슬롯 주변 대안 — 성격이 같다 |
| `route_service.py:218` 루트 생성 폴백 | **`random` 유지** | 도시 중심 30 km에서 다양하게 뽑아야 한다. 거리순이면 매번 도심 근처만 나온다 |

기본값을 `random`으로 고정하면 루트 생성 폴백은 **한 줄도 안 건드린다.**

### 1-2. 판단은 서버가, 문구는 모델이

프로액티브 엔진에서 확립한 원칙을 그대로 쓴다. 서버는 불리언만 주고 한국어를 넣지 않는다:

```python
expanded = any(d.metadata["distance_m"] > radius_m for d in top_candidates)
origin_info = {..., "search_radius_m": radius_m, "expanded": expanded}
```

**모델이 숫자를 비교하게 만들지 않는 게 요점이다.** `expanded`를 리트리버가 아니라 도구에서 반환 문서로부터 계산하므로 리트리버 API를 안 건드리고, 리트리버는 순수 검색기로 남는다.

### 1-3. ④ — 기존 해석기 재사용

`origin` enum에 `"place"`를 더하고 `origin_place`(장소명)를 받는다. `origin_place`만 추가해 "값이 있으면 우선"으로 하면 `origin`과 중복 신호가 되어 모델이 흔들리므로, 기존 `accommodation` 분기와 대칭이 되게 enum을 확장한다.

이름→슬롯 해석은 **`_match_slot`(`chat_service.py:515`)을 그대로 재사용한다** — `insert_before_place`용으로 이미 검증된 함수다(정확 일치 → 부분 일치 → 오늘 이후 첫 번째).

`_resolve_insertion`의 인라인 슬롯 쿼리를 `_load_route_slots(db, route_id)`로 추출하고 `lng`/`lat`를 SELECT에 추가해 두 곳이 공유한다. `_estimate_current_slot:245`가 이미 같은 방식으로 좌표를 뽑고 있어 패턴이 있다.

`origin_info.name`은 **모델이 보낸 문자열이 아니라 DB 슬롯 이름**을 쓴다 — 클라이언트 문자열을 그대로 되돌려주지 않는 원칙(결함 4에서 `proactiveContext`로 겪고 막은 것)을 지킨다.

---

## 2. 실패 시나리오 (FFE Step 1 & 2)

| # | 상황 | 대응 |
|---|---|---|
| 1 | `origin="place"`인데 `origin_place`가 비어 있음 | `current` 경로로 폴백. 예외 안 던짐 |
| 2 | `origin_place`가 일정에 없는 장소(환각) | `_match_slot` → None → `current` 폴백. `origin_info.kind`가 실제로 쓴 기준점을 밝히므로 모델이 "남산공원 기준"이라 거짓말하지 않는다 |
| 3 | 같은 이름 슬롯이 여러 Day에 | `_match_slot`의 기존 결정 규칙(오늘 이후 첫 번째)에 위임 |
| 4 | 루트에 슬롯이 하나도 없음 | 빈 리스트 → `current` 폴백 |
| 5 | `distance_m`이 없는 Document | `describe_candidate`가 기존 문구로 폴백 |
| 6 | 태그 제거 폴백이 걸려 카테고리가 안 맞는 결과 | 기존 동작 유지. `expanded`가 참이라 모델이 "근처엔 카페가 없어서"를 밝힌다 |
| 7 | `sort`에 열거 밖 값 | `Literal`이 Pydantic 단계에서 거부 |
| 8 | 슬롯 좌표가 NULL | `places` FK라 `location`이 NOT NULL — 발생 불가. 방어 코드 안 넣는다 |

---

## 3. 구현 단계 (FFE Step 3 — 성공 경로)

### Step 1 — `retrievers.py`: 정렬 모드 + 거리

- `PostgisTagRetriever`에 `sort: Literal["random", "distance"] = "random"` 필드
- `_fetch`의 두 쿼리(태그 유/무) SELECT에 거리 컬럼:
  ```sql
  ST_Distance(location::geography, ST_MakePoint($1, $2)::geography) AS distance_m
  ```
- `ORDER BY`를 `sort`에 따라 분기. `sort`는 파라미터 바인딩이 불가한 위치라 SQL 문자열 조립이 되는데, `Literal` 화이트리스트라 열거 밖 값이 들어올 수 없다 — `_tool_search_nearby_places`의 `origin == "accommodation"` 화이트리스트 분기와 같은 근거를 주석으로 남긴다
- `Document.metadata`에 `distance_m: float`
- 폴백 체인(`radius_m` → 50 km → 태그 제거)은 **그대로 둔다**

### Step 2 — `describe_candidate` 거리 반영

지금 거리를 모른 채 `"동선상 가까운 위치"`라고 단정한다 — 27 km 결과에는 거짓이다. `metadata["distance_m"]`가 있으면 거리를 문구에 반영하고, 없으면 기존 문구로 폴백(FFE #5). 슬롯 대안·챗봇 카드가 공유하는 함수라 양쪽에 동시에 반영된다.

### Step 3 — 호출부 2곳에 `sort="distance"`

`chat_service.py:353`, `slot_alternatives.py:81`. `route_service.py:218`은 미변경.

### Step 4 — `_tool_search_nearby_places`: 거리 싣기 + `origin="place"` 분기

- `places[]` 각 항목에 `distance_m`
- `origin_info`에 `search_radius_m`, `expanded`
- `origin == "place"` → `_load_route_slots` → `_match_slot(slots, origin_place, insert_day, today_day)` → 그 슬롯 `(lng, lat)`를 `center`로. 매칭 실패면 `current` 경로로 흘려보낸다(FFE #1, #2)

### Step 5 — 도구 스키마 + 시스템 프롬프트

- `TOOLS`의 `origin` enum에 `"place"` 추가, `origin_place` 인자 추가
- **도구 description 본문에도 적는다** — 규칙 목록에만 적었을 때 모델이 명시된 요청에도 인자를 비워 보낸 게 실측됐다(`insert_*` 때의 교훈). 모델은 도구 설명을 훨씬 무겁게 읽는다
- 규칙 3 수정: 일정 장소 기준을 "되묻기" 앞에 끼운다
- 규칙 추가: `origin.expanded`가 참이면 근처에 없었다는 사실과 실제 거리를 반드시 밝힌다

### Step 6 — 테스트

**`tests/test_retrievers.py`** (기존 mock `db` 픽스처 스타일)
- `sort="distance"` → SQL에 `ORDER BY distance_m`
- 기본값 → `ORDER BY RANDOM()` 유지 (회귀 방지)
- `Document.metadata`에 `distance_m`
- 태그 정규화·폴백 체인 기존 테스트 통과

**챗봇** (`test_chat_accommodation.py`의 `patch.object(chat_service, "PostgisTagRetriever", ...)` 패턴 재사용)
- `origin="place"` + 일정에 있는 장소명 → 그 슬롯 좌표가 `city_coords`로 전달
- 일정에 없는 이름 → `current` 폴백 (FFE #2)
- `expanded` 계산

**`tests/test_slot_alternatives.py`** — 기존 3개 테스트가 `sort="distance"` 후에도 통과

### Step 7 — 문서

- `docs/06-ai-chatbot.md` — `origin="place"` / `origin_place` / `distance_m`
- `planning/unimplemented.md` — 원인 ①(카페 데이터 부족) 기록 ✅
- `planning/milestones.md` — 완료 항목

---

## 4. 검증 방법

```bash
# 1. AI 단위 테스트
cd ai && .venv/bin/python -m pytest -q
# 기대: 156 + 신규분 passed

# 2. 거리순이 실제로 걸리는지 — 증상을 재현했던 그 질문 그대로
K=$(grep -E "^INTERNAL_API_KEY=" ai/.env | cut -d= -f2)
curl -s -X POST http://localhost:8000/ai/chat -H "X-Internal-Key: $K" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"dc3867ff-58c7-4db6-8990-bc98ff7e4438",
       "route_id":"448c2939-2cb3-4206-b142-36f3aaf4207e",
       "message":"숙소 근처 카페 알려줘","language":"ko"}' | jq '.places'
# 기대: 5곳 전부 거리 오름차순. 인천(27km)·홍천(49km) 사라짐
#       (수정 전 실측: 5.1 / 5.2 / 5.8 / 23.8 / 27.3 km)

# 3. 챗봇이 거리를 밝히는지
# 기대: reply에 "근처엔 없어서" 류 + 실제 거리 언급

# 4. ④ — 수정 전엔 되물었던 질문
#    message: "남산공원 근처 카페 추천해줘"
# 기대: 되묻지 않고 places 5건, origin.kind == "place"

# 5. 슬롯 대안 회귀 없음 — POST /ai/slots/alternatives 후보가 거리순
```

**DB로 기대값 독립 대조** — 2번 결과가 이 5곳과 일치해야 한다:
```sql
SELECT p.name, round((ST_Distance(p.location, o.location)/1000)::numeric,1) AS km
FROM places p, (SELECT location FROM accommodations WHERE name LIKE '%남산힐%' LIMIT 1) o
WHERE p.is_active AND p.is_curated AND '#카페' = ANY(p.category_tags)
ORDER BY 2 LIMIT 5;
```

---

## 5. 체크리스트

- [x] 노션 태스크 생성
- [x] Step 1 `retrievers.py` `sort` + `distance_m`
- [x] Step 2 `describe_candidate` 거리 반영
- [x] Step 3 호출부 2곳 `sort="distance"`
- [x] Step 4 `_tool_search_nearby_places` 거리 + `origin="place"`
- [x] Step 5 도구 스키마 + 프롬프트 규칙 2건 (규칙 11·12)
- [x] Step 6 테스트 (156 → 167 passed, 신규 11건)
- [x] Step 7 문서 (`06-ai-chatbot.md`, `unimplemented.md`, `milestones.md`)
- [x] FFE #1~#8 처리 확인
- [x] 검증 1~4 실행 (DB 독립 대조 5곳 전부 일치)
- [ ] 검증 5 — 슬롯 대안 실경로 회귀 확인 (단위 테스트 3건은 통과, HTTP 호출은 미실행)
- [x] 임시 진단 로그 → 정식 로그로 승격 (`장소 검색 tags=... sort=... → N건`)

### 구현 중 계획과 달라진 점

1. **`ai/app/routes/chat.py`의 `PlaceCard` 스키마도 건드렸다.** 계획엔 없었는데, `distance_m`을 도구 반환에만 넣으니 Pydantic 응답 모델이 그 필드를 떨어뜨려 답변 문장에는 거리가 있고 카드 목록에는 없는 상태가 됐다. 응답 스키마에 `distance_m: int | None`을 추가했다(Spring·앱은 아직 안 쓴다).
2. **`_match_slot`에 빈 문자열 방어를 호출 지점에 넣었다.** 부분 일치 조건이 `name in place_name`이라 `origin_place=""`면 모든 슬롯에 걸려 첫 슬롯이 기준점이 된다 — FFE #1을 코드로 옮기는 단계에서 발견했다. 기존 호출부도 `if target:`으로 막고 있어 같은 방식(월러스 연산자 가드)을 썼다.
3. **프롬프트 규칙 11에 "내부 수치를 그대로 말하지 말라"를 덧붙였다.** 첫 검증에서 모델이 *"반경 1500m 안에는 없어서"* 라고 `search_radius_m`을 사용자에게 그대로 노출했다.
4. **예상보다 결과가 좋았다.** 계획은 "5.1km가 1등으로 올라온다"를 기대했는데 실제로는 `2.4km`부터 나왔다 — `ORDER BY RANDOM()`이 **더 가까운 카페들을 아예 못 보여주고 있었다.**

---

## 6. 범위 밖 (의도적 제외)

| 항목 | 왜 빼는가 |
|---|---|
| `#카페` 데이터 수집 (원인 ①) | 데이터 파이프라인 트랙이라 성격이 다르다. `unimplemented.md`에 기록 |
| 단계적 반경 확장 (원인 ②) | 거리순 정렬로 무해해진다 — 위 「왜 ②를 손대지 않는가」 |
| 카드에 거리 배지 표시 | AI → Spring → 프론트 3계층 변경이 필요하다. 먼저 챗봇 문장으로 내고 실사용을 본다 |
| `route_service.py` 폴백 정렬 | 도시 전체 다양성이 목적이라 `RANDOM`이 맞다 |
| 태그 어휘를 도구 스키마에 enum으로 고정 | 이번 증상의 원인이 아니었다(모델이 정확한 태그를 보냈다). 탐색 탭의 「테마 태그 어휘 불일치」와 함께 다루는 게 맞다 |

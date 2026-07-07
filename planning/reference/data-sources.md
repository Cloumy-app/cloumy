# 데이터 소스 & 추천 알고리즘 참고서

AI 루트 추천에 사용되는 모든 외부 데이터 소스와 처리 방식을 정리한다.

---

## 1. TourAPI (한국관광공사 오픈 API)

**역할**: places 테이블의 핵심 시드 데이터. 국내 관광지·맛집·숙박·문화시설 정보  
**비용**: 무료 (공공 API)  
**커버리지**: 전국 (MVP는 주요 20개 도시 대상 수집)

### 사용 엔드포인트

| 엔드포인트 | 용도 |
|-----------|------|
| `areaBasedList` | 지역별 전체 장소 목록 조회 |
| `detailCommon` | 장소 상세 정보 (주소, 좌표, 전화번호) |
| `detailIntro` | 카테고리별 세부 정보 (운영시간, 입장료 등) |
| `detailImage` | 장소 이미지 URL |

### 수집 방식
```
TourAPI 수집기 (배치, Week 3~4)
  → 도시별 전체 장소 조회 (areaBasedList)
  → 상세 정보 보강 (detailCommon + detailIntro)
  → places 테이블 INSERT
  → OpenAI text-embedding-3-small로 임베딩 생성
  → pgvector (embedding 컬럼) 저장
```

### 데이터 필드 매핑

| TourAPI 필드 | places 테이블 컬럼 | 비고 |
|-------------|-------------------|------|
| `contentid` | 외부 참조용 메타 | places.id는 UUID로 별도 생성 |
| `contenttypeid` | category_tags | 12=관광지, 39=식당, 32=숙박 등 |
| `mapx`, `mapy` | location (PostGIS POINT) | WGS84 좌표계 |
| `addr1` | address | 도로명 주소 |
| `firstimage` | - | S3 업로드 후 저장 (MVP 이후) |

### 카테고리 코드 → Cloumy 태그 변환

| TourAPI contentTypeId | Cloumy 태그 |
|----------------------|-------------|
| 12 (관광지) | `#뷰맛집`, `#랜드마크` |
| 14 (문화시설) | `#실내`, `#역사` |
| 15 (축제/행사) | `#이벤트` |
| 28 (레포츠) | `#액티비티` |
| 32 (숙박) | `#숙박` (루트 슬롯 아닌 예산 참고용) |
| 38 (쇼핑) | `#쇼핑` |
| 39 (음식점) | `#먹방`, `#식당` |

---

## 2. 카카오 로컬 API

**역할**: ① TourAPI 부족분 실시간 보충 ② 챗봇 현위치 기반 검색 ③ 카카오 리뷰 수 조회  
**비용**: 월 300,000 트랜잭션 무료, 초과 시 유료  
**기준 키**: `KAKAO_REST_API_KEY`

### 사용 API 목록

#### 2-1. 키워드 검색 (`/v2/local/search/keyword.json`)

```http
GET https://dapi.kakao.com/v2/local/search/keyword.json
Authorization: KakaoAK {REST_API_KEY}

파라미터:
  query       = "부산 해산물 맛집"
  x           = 129.0756  (경도, 중심 좌표)
  y           = 35.1796   (위도)
  radius      = 20000     (반경 미터, 최대 20000)
  size        = 15        (결과 수, 최대 15)
  page        = 1
  category_group_code = FD6  (음식점만 필터)
```

**Cloumy 사용 케이스**:
- RAG 후보 부족 시 실시간 보충 (20개 미만일 때 자동 호출)
- 챗봇: "지금 근처 카페 추천" → 현위치 + "카페" 키워드 검색

**응답 핵심 필드**:
```json
{
  "documents": [{
    "id": "카카오 장소 ID",
    "place_name": "자갈치시장",
    "category_name": "음식점 > 수산물",
    "address_name": "부산 중구 자갈치해안로",
    "road_address_name": "부산 중구 자갈치해안로 52",
    "x": "129.0256",   // 경도
    "y": "35.0972",    // 위도
    "place_url": "https://place.map.kakao.com/...",
    "phone": "051-245-2594",
    "distance": "320"  // 중심으로부터 거리(m), x,y 지정 시
  }]
}
```

#### 2-2. 카테고리 검색 (`/v2/local/search/category.json`)

```http
GET https://dapi.kakao.com/v2/local/search/category.json
Authorization: KakaoAK {REST_API_KEY}

파라미터:
  category_group_code = CE7  (카페)
  x, y = 현재 좌표
  radius = 500               (챗봇용, 500m 이내)
  sort = distance
```

**카테고리 코드**:
| 코드 | 분류 |
|-----|------|
| FD6 | 음식점 |
| CE7 | 카페 |
| CT1 | 문화시설 |
| AT4 | 관광명소 |
| AD5 | 숙박 |

#### 2-3. 좌표 → 주소 변환 (`/v2/local/geo/coord2address.json`)

Hidden Gems 등록 시 GPS 좌표를 도로명 주소로 변환  
```http
GET https://dapi.kakao.com/v2/local/geo/coord2address.json?x=129.07&y=35.17
```

### 카카오 리뷰 수 활용 (희소성 점수 계산)

> ⚠️ 카카오 리뷰 수는 공식 API로 직접 제공되지 않음.  
> **대안**: `place_url`에서 `kakao_place_id` 추출 → `place.map.kakao.com/{id}` 스크래핑 or  
> **실용적 대안**: 키워드 검색 결과 `distance`, `review_count` 는 비공개 필드라 불안정 →  
> **MVP 선택**: TourAPI `readcount` (조회수) + 카카오 검색 노출 여부로 간접 대체

---

## 3. OpenWeatherMap API

**역할**: 여행 날짜의 날씨 예보 → 실외/실내 장소 가중치 조정  
**비용**: 무료 티어 일 1,000콜 (MVP 충분), 초과 시 월 $40~  
**기준 키**: `OPENWEATHERMAP_API_KEY` (openweathermap.org → My API Keys)  
**선택 이유**: 국내·해외 통합 (기상청 API는 국내 전용), REST API 단순, 무료 한도 충분

### 사용 엔드포인트

```
GET /data/2.5/forecast      (5일 3시간 단위 예보)
GET /data/2.5/weather       (현재 날씨)
```

### 요청 예시
```http
GET https://api.openweathermap.org/data/2.5/forecast
  ?lat=35.1796
  &lon=129.0756
  &appid={OPENWEATHERMAP_API_KEY}
  &units=metric
  &lang=kr
  &cnt=40               # 5일 × 8회 (3시간 간격)
```

### 응답 핵심 필드
```json
{
  "list": [{
    "dt": 1720598400,
    "pop": 0.64,            // 강수 확률 (0~1)
    "weather": [{"main": "Rain", "description": "보통 비"}],
    "main": {"temp": 27.3}
  }]
}
```

### Cloumy 활용 방식
```python
# RAG 파이프라인 Step 3 (필터링) 내에서 실행
weather_forecast = await get_weather(destination, travel_dates)

for slot_candidate in candidates:
    if weather_forecast.rain_probability > 0.6:  # 강수확률 60% 이상
        if '야외' in slot_candidate.tags or '해변' in slot_candidate.tags:
            slot_candidate.score *= 0.3   # 가중치 하향
        if '실내' in slot_candidate.tags or '박물관' in slot_candidate.tags:
            slot_candidate.score *= 1.5   # 가중치 상향
```

### MVP 포함 여부 결정
> ✅ **포함** — 단 조건부:  
> - Week 5~6에 루트 생성 MVP 완성 후, Week 7~8에 날씨 연동 추가  
> - API 장애 시 날씨 필터 없이 정상 생성 (graceful fallback 필수)

---

## 4. OpenAI text-embedding-3-small

**역할**: places 테이블의 `embedding` 컬럼 생성 (pgvector 검색의 핵심)  
**비용**: $0.020 / 1M tokens → 장소 10만 개 기준 $2~3 (1회성 배치)  
**차원**: 1536 (pgvector `vector(1536)` 타입)

### 임베딩 생성 대상 텍스트
```python
# 각 장소마다 텍스트 조합해서 임베딩 생성
embed_text = f"{place.name} {place.address} {' '.join(place.category_tags)}"
# 예: "자갈치시장 부산 중구 자갈치해안로 먹방 해산물 전통시장 현지인픽"
```

### pgvector 유사도 검색
```sql
-- RAG 파이프라인 Step 2에서 실행
SELECT id, name, location, category_tags,
       embedding <=> '[0.123, -0.456, ...]'::vector AS distance
FROM places
WHERE ST_DWithin(location, ST_MakePoint(129.07, 35.17)::geography, 20000)  -- 반경 20km
ORDER BY distance
LIMIT 30;
```

---

## 5. Claude API (Anthropic)

**역할**: 루트 생성 LLM, 챗봇  
**모델 라우팅 요약**:

| 기능 | 모델 | 이유 |
|------|------|------|
| AI 루트 생성 | claude-sonnet-4-6 | 복잡한 Day별 JSON 구조 안정적 출력 |
| Pin & Reshuffle | claude-haiku-4-5-20251001 | 단순 슬롯 교체, 비용 절약 |
| 챗봇 단순 질문 | claude-haiku-4-5-20251001 | 1~2초 응답 목표 |
| 챗봇 루트 수정 | claude-sonnet-4-6 | 멀티턴 + Function Calling |
| 지출 자연어 파싱 | claude-haiku-4-5-20251001 | 간단한 분류 작업 |

### Prompt Caching 전략
```python
# 시스템 프롬프트 (장소 DB 가이드라인, 루트 생성 규칙 등)은 거의 변하지 않음
# → cache_control: ephemeral 적용 → 5분 TTL → 입력 비용 ~90% 절감

messages = [
    {
        "role": "system",
        "content": [{
            "type": "text",
            "text": ROUTE_GEN_SYSTEM_PROMPT,   # ~2000 tokens
            "cache_control": {"type": "ephemeral"}
        }]
    },
    {
        "role": "user",
        "content": f"후보 장소: {json.dumps(candidates)}\n요청: {user_input}"
        # ↑ 매 요청마다 다른 부분 — 캐시 제외
    }
]
```

---

## 6. 콘서트·이벤트 앵커 — KOPIS + Serper API (P1, 계획·미구현)

> 2026-07-06 타겟 전환 이후 K-pop 콘서트 투어리스트 페르소나 대응을 위해 두 소스를 역할 분리해서 쓰기로 함 (Notion "3. 핵심 기능 & MVP 범위" Feature 6 참고).

### 6-1. KOPIS (공연예술통합전산망)
**역할**: 클래식·뮤지컬·연극 등 정형화된 공연 데이터  
**비용**: 무료 공공 API  
**MVP 포함 여부**: P1 (출시 후 추가)

### 6-2. Serper API (신규)
**역할**: K-pop 콘서트·팝업스토어 등 KOPIS에 없는 이벤트를 실시간 웹 검색으로 보강  
**비용**: 유료 (검색 요청당 과금 — 요금제는 별도 확인 필요)  
**MVP 포함 여부**: P1 (계획, 미구현)

**파이프라인**:
```
유저 검색 (예: "SEVENTEEN Seoul concert August")
    ↓
pgvector DB 조회 → TTL 7일 이내 데이터 있으면 즉시 반환
    ↓ (없으면)
Serper API 실시간 웹 검색 → LLM(Haiku) 구조화 추출 (공연명/일시/장소)
    ↓
DB 저장 (TTL 7일) → 공연 카드 표시 → "일정에 추가"
```

**라우팅 기준**: 클래식·뮤지컬·연극은 KOPIS 우선 조회, K-pop·팝업스토어 등 KOPIS 커버리지 밖인 이벤트는 Serper로 폴백.

**앵커 동작**: 이벤트 블록을 루트에 🎵 고정 배치 → 공연 전(2~4시간) 근처 식사 루트 자동 배치, 공연 후 야식·귀숙 경로 자동 안내.

---

## 7. Google Maps Platform

**역할**: 지도 렌더링 (react-native-maps), 경로선 표시  
**비용**: MAU 1만 기준 월 $100~200 예상  
**사용 API**:
- Maps JavaScript API / iOS SDK → 지도 렌더링
- Geocoding API → 주소 ↔ 좌표 변환 (TourAPI 좌표 검증용)
- Distance Matrix API → OR-Tools TSP 이동 거리/시간 계산 (Week 5~8)

---

## 9. 네이버 블로그 검색 API (트렌딩 장소)

**역할**: `places.trend_score` 주기적 갱신 — 핫플·유행 장소 RAG 가중치 반영  
**비용**: 무료 (하루 25,000콜)  
**키**: `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` (`ai/.env`)  
**수집 주기**: 배치, 주 1회  
**파이프라인 파일**: `scripts/collect_naver_trend.py`

### 사용 엔드포인트

```http
GET https://openapi.naver.com/v1/search/blog.json
X-Naver-Client-Id: {NAVER_SEARCH_CLIENT_ID}
X-Naver-Client-Secret: {NAVER_SEARCH_CLIENT_SECRET}

파라미터:
  query   = "부산 핫플"   # 목적지 + 키워드 조합
  display = 100
  sort    = date          # 최신순 → 최근 트렌드 반영
```

### trend_score 계산

```python
# 키워드 예시: "#{목적지} 맛집", "#{목적지} 카페", "#{목적지} 핫플"
blog_count = naver_blog_search(f"{destination} {place_name}").total_count
kakao_review_count = place.review_count  # 카카오 로컬 API 수집 시 저장

# 가중 합산
raw_score = blog_count * 0.6 + kakao_review_count * 0.4

# 전체 장소 분포에서 백분위 정규화 (0~100)
trend_score = get_percentile(raw_score, all_places_scores)

# 업데이트
place.trend_score = trend_score
place.trend_updated_at = now()
place.trend_source = ['naver_blog', 'kakao']
```

### RAG 가중치 연동

| 사용자 태그 선택 | trend_weight | 비고 |
|----------------|-------------|------|
| 🔥 핫플·트렌딩 | 0.4 | 최근 블로그 언급 많은 장소 우선 |
| 🏡 현지인 로컬 | 0.1 | 트렌딩 하향, 덜 알려진 장소 우선 |
| 미선택 (기본값) | 0.25 | 균형 |

> ※ trend_weight는 Hidden Gems 비율(방문빈도 질문)과 독립적으로 동작

---

## 8. 데이터 수집 파이프라인 전체 흐름

```
[Week 3~4 배치 작업]

TourAPI + 카카오 로컬 API (동시 적재 — 두 소스 항상 혼합)
  TourAPI:
    → 도시별 areaBasedList 전체 수집
    → 상세 정보 (detailCommon) 병렬 요청 (rate limit: 1000/일)
    → places 테이블 INSERT (source='tourapi')
  카카오 로컬 API:
    → 카테고리별 키워드 검색 (FD6 음식점, CE7 카페, AT4 관광명소)
    → TourAPI와 독립적으로 places 테이블 INSERT (source='kakao')
    → 좌표 정확도 검증 (TourAPI 좌표 이상 시 카카오 좌표로 교정)

네이버 블로그 검색 API (배치, 주 1회)
  → "#{목적지} 맛집", "#{목적지} 카페", "#{목적지} 핫플" 검색
  → 블로그 게시물 수 + 카카오 리뷰 수 → trend_score 계산 및 갱신

OpenAI Embedding (BackgroundTasks)
  → places 테이블 신규 행마다 비동기 임베딩 생성
  → embedding 컬럼 업데이트
  → pgvector 인덱스 갱신

[실시간 — 루트 생성 요청 시]

카카오 로컬 API
  → 카테고리별 최소 쿼터 미달 시만 실시간 보충 (기존 "총 20개 미만" 조건 폐기)
    쿼터 기준 (normal): 식당·카페 2개 + 관광·체험 2개 + 기타 1개
  → 챗봇 현위치 검색

OpenWeatherMap API
  → 여행 날짜 예보 조회 (Day별 강수확률, 국내·해외 통합)
  → 장소 가중치 조정
```

---

## 10. 네이버 지역검색 API (신규 장소 보강 — 2026-07-05)

**역할**: TourAPI+카카오가 놓친 장소 보강. 카카오는 도시 단위 넓은 검색이 TourAPI와 겹쳐 신규 삽입 0건이었던 문제(2026-06-29 실행)를 **동네 단위로 좁힌 키워드**로 해결.
**비용**: 무료 (하루 25,000콜)
**키**: `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` (`ai/.env`, 네이버 개발자센터에서 "검색" API에 블로그+지역 모두 등록해야 함 — 둘 중 하나만 등록하면 다른 쪽이 401 남)
**파이프라인 파일**: `scripts/collect_naver_local.py`

### 사용 엔드포인트

```http
GET https://openapi.naver.com/v1/search/local.json
X-Naver-Client-Id: {NAVER_SEARCH_CLIENT_ID}
X-Naver-Client-Secret: {NAVER_SEARCH_CLIENT_SECRET}

파라미터:
  query   = "전주 삼천동 로컬 맛집"   # 카카오와 달리 x/y/radius 파라미터가 없음 —
                                      # 검색어 텍스트 자체에 지역명이 들어가야 지역이 좁혀짐
  display = 5                        # 최대 5건(카카오 15건×45페이지보다 훨씬 적음), 페이지네이션 사실상 없음
```

**응답 좌표**: `mapx`/`mapy`는 WGS84 경도/위도 × 10^7 (실측 검증됨 — 해운대해수욕장 `mapx=1291583542`→`129.1583542`). `ST_MakePoint` 전에 반드시 `/10_000_000` 필요.

### 동네 단위 키워드 전략 (카카오 실패 반복 방지)

```python
AREAS = {"전주": ["전주 한옥마을", "전주 삼천동", ...], ...}  # 도시 전체 아닌 동네 샘플
KEYWORD_TEMPLATES = ["{area} 맛집", "{area} 카페", "{area} 로컬 맛집", "{area} 노포", "{area} 술집"]
```

동네×키워드 조합으로 쿼리를 쪼개야 카카오/TourAPI가 이미 찾은 "잘 알려진 곳"이 아닌 결과가 나올 여지가 생김. QPS 제한이 꽤 엄격해(연속 호출 시 429) 쿼리 간 0.2초 딜레이 + 429 시 1회 재시도 필요.

### dedup 규칙 (카카오와 동일)

반경 150m + 이름 유사 시: 기존이 `tourapi`이고 100m 이상 어긋나면 좌표만 교정, 그 외엔 스킵. 안 겹치면 `source='naver'`로 신규 INSERT.

### 실측 결과 (2026-07-05, 전국 14개 도시)

| 방식 | 대상 | 순증 |
|------|------|------|
| 카카오(도시 단위 광역 검색) | 20개 도시 | 0건 |
| 네이버(동네 단위 검색) | 14개 도시(동네 5곳×키워드 5개) | **1,180건** |

`places` 20,363 → 21,543건 (source별: tourapi 20,363 / naver 1,180). 신규 행은 `embedding IS NULL` 상태이므로 `generate_embeddings.py` 재실행 필요.

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

## 6. KOPIS (공연예술통합전산망) — P1

**역할**: 콘서트·공연 일정 앵커 배치 (페르소나 C 지원)  
**비용**: 무료 공공 API  
**MVP 포함 여부**: P1 (출시 후 추가)

---

## 7. Google Maps Platform

**역할**: 지도 렌더링 (react-native-maps), 경로선 표시  
**비용**: MAU 1만 기준 월 $100~200 예상  
**사용 API**:
- Maps JavaScript API / iOS SDK → 지도 렌더링
- Geocoding API → 주소 ↔ 좌표 변환 (TourAPI 좌표 검증용)
- Distance Matrix API → OR-Tools TSP 이동 거리/시간 계산 (Week 5~8)

---

## 8. 데이터 수집 파이프라인 전체 흐름

```
[Week 3~4 배치 작업]

TourAPI
  → 도시별 areaBasedList 전체 수집
  → 상세 정보 (detailCommon) 병렬 요청 (rate limit: 1000/일)
  → places 테이블 INSERT

카카오 로컬 API
  → TourAPI 미수집 장소 보강 (핫플, 최신 맛집)
  → 좌표 정확도 검증 (TourAPI 좌표 이상 시 카카오 좌표로 교정)

OpenAI Embedding (BackgroundTasks)
  → places 테이블 신규 행마다 비동기 임베딩 생성
  → embedding 컬럼 업데이트
  → pgvector 인덱스 갱신

[실시간 — 루트 생성 요청 시]

카카오 로컬 API
  → RAG 후보 20개 미만 → 키워드 검색으로 즉시 보충
  → 챗봇 현위치 검색

OpenWeatherMap API
  → 여행 날짜 예보 조회 (Day별 강수확률, 국내·해외 통합)
  → 장소 가중치 조정
```

---
feature: AI 루트 생성
stack: ai + backend + db
status: in_progress
created: 2026-06-08
---

# AI 루트 생성 구현 계획서

## 기능 요약

사용자가 목적지·날짜·인원·여행 스타일을 3단계로 입력하면, FastAPI AI 서비스가 LangChain LCEL + RAG(pgvector) + OR-Tools TSP + Claude Sonnet 4.6을 통해 Day별 최적 여행 루트를 생성하고, Spring Boot가 SSE 스트리밍으로 클라이언트에 반환한다. 생성된 루트는 PostgreSQL에 저장되며, 트립 패스 없는 사용자는 미리보기만 가능하다.

---

## 구현 단계 (Phase A → B → C)

### Phase A — LangChain LCEL + PostGIS 태그 MVP (현재 구현)

embedding 없이 즉시 구현. LCEL 체인 구조를 Phase A부터 적용해 Phase B 전환 비용 최소화.

**핵심 결정 — CITY_CENTERS 딕셔너리 하드코딩:**
도시 좌표를 Haiku API 호출 없이 딕셔너리에서 즉시 조회 (불필요한 LLM 토큰 제거).

**LCEL 파이프라인:**
```python
# Phase A — PostgisTagRetriever
route_chain = (
    {"context": PostgisTagRetriever(...), "request": RunnablePassthrough()}
    | route_prompt  # cache_control: {"type": "ephemeral"}
    | ChatAnthropic(model="claude-sonnet-4-6")
    | StrOutputParser()
)
```

**생성 파일 (FastAPI 5개 + Spring 4개 + yml):**
- `ai/app/models/schemas.py` — RouteGenRequest
- `ai/app/services/retrievers.py` — PostgisTagRetriever(BaseRetriever)
- `ai/app/services/route_service.py` — CITY_CENTERS + Haiku LCEL + Sonnet LCEL
- `ai/app/routes/route_gen.py` — POST /ai/routes/generate
- `ai/app/main.py` 수정 — include_router
- `trip/entity/Route.java`, `trip/repository/RouteRepository.java`
- `trip/service/AiServiceClient.java` — Java 21 HttpClient ndjson 스트리밍
- `trip/controller/RouteController.java` — SseEmitter
- `application.yml` — app.fastapi.url, app.internal-api-key

### Phase B — Retriever만 교체 (앱 확인 후)

나머지 체인 동일, Retriever 한 줄만 스왑. OpenAI 임베딩 배치 생성(20,363건, ~$2~3) 선행 필요.

```python
# Phase B — PgvectorRetriever로 스왑
route_chain = (
    {"context": PgvectorRetriever(...), "request": RunnablePassthrough()}  # ← 이것만 변경
    | route_prompt | sonnet_llm | StrOutputParser()
)
```

추가: `ai/scripts/generate_embeddings.py`, `tsp_service.py` (OR-Tools TSP)

### Phase C — 품질 개선

`place_validator.py` (환각 방지), Redis 루트 캐시, Rate Limiting, 카카오 로컬 보충, E2E 테스트

---

## PRD 구체화

### 정확한 동작 범위

**[입력 — 3단계 플로우]**
- Step 1: 목적지 선택 — MVP: 5개 핵심 여행지 (제주, 부산, 서울, 경주, 강릉) / 베타 출시 전: 국내 20개 도시 확장
- Step 2: 날짜(시작/종료) + 그룹 구성(혼자/커플/친구들/가족) + 예산 수준(가성비/중간/프리미엄)
  - ※ 가족 그룹은 MVP에서 단일 옵션으로 처리, 이후 '부모님과 함께 / 아이와 함께' 세분화 예정
- Step 3: 여행 스타일 태그(체크박스 복수 선택) + [선택] 교통수단(대중교통/렌터카/도보) / 숙소 위치(동선 최적화 기준점) / 하루 활동량(여유/보통/빡빡) + 앵커 장소(선택)
  - 여행 스타일 태그에 포함: 🔥 핫플·트렌딩 (trend_weight 0.4) / 🏡 현지인 로컬 (trend_weight 0.1) — 둘 다 미선택 시 기본값 0.25
  - "이 지역 얼마나 자주 가세요?" (처음이에요 / 가끔 가요 / 자주 가요) → Hidden Gems 비율 제어 (0% / 20% / 50%)
  - ※ 트렌딩 취향(핫플/로컬 태그)과 지역 친숙도(방문빈도)는 독립적으로 동작 — 처음 가면서 핫플 원하는 경우도 지원

**[AI 처리 — FastAPI + LangChain LCEL]**
1. LangChain → Haiku: `themes` → category_tags 키워드 추출 ("부산 먹방 해산물" 등)
2. RAG Retrieval:
   - **Phase A**: `PostgisTagRetriever` — `ST_DWithin(30km) + category_tags &&` 태그 필터 → 후보 50개
   - **Phase B**: `PgvectorRetriever` — pgvector 유사도(OpenAI 임베딩) + PostGIS 반경 + 태그 멀티소스 병렬 → 후보 50~100개
     - places 테이블 = TourAPI 배치 + 카카오 배치 항상 둘 다 적재 → 두 소스 항상 혼합
     - 최종 점수: `similarity_score * 0.6 + trend_score * trend_weight + rarity_score * hidden_gem_weight`
     - trend_weight: 🔥 핫플·트렌딩 태그 → 0.4 / 🏡 현지인 로컬 태그 → 0.1 / 기본 → 0.25
     - hidden_gem_weight: 처음이에요 → 0 / 가끔 가요 → 0.1 / 자주 가요 → 0.3
3. 카테고리 쿼터 보장 + 실시간 보충:
   - 하루 최소 쿼터 (normal 기준): 식당·카페 2개(카카오 소스 우선) + 관광·체험 2개(TourAPI 소스 우선) + 기타 1개
   - 카카오 실시간 API: 카테고리별 쿼터 미달 시만 호출 (기존 "총 20개 미만" 조건 폐기)
4. OpenWeatherMap API: 여행 날짜 강수확률 조회 → 실외/실내 가중치 조정 (graceful fallback, 국내·해외 통합)
5. OR-Tools TSP: 앵커 장소 고정 + 나머지 동선 최적화 (Google Maps Distance Matrix 활용)
6. LangChain → Claude Sonnet 4.6: Day별 루트 스트리밍 생성 (Prompt Caching 적용)
7. 환각 방지: LLM 출력 place_id DB 재검증 → 없는 ID는 pgvector 유사도로 자동 교체

**[출력]**
- Day별 슬롯: 장소명, 방문 시각, 체류 시간, 예상 비용, 이동 수단/시간, AI 팁
- 스트리밍: Day 1 완성 즉시 클라이언트 노출, 이후 Day 순차 추가
- 첫 생성 5~10초 / Redis 캐시 히트 1초 이내

**[저장]**
- Spring이 스트리밍 완료 후 routes + route_slots 테이블에 저장
- 트립 패스 없는 사용자: AI 생성은 동일하게 수행, 저장 단계에서 Spring이 차단 (403 + 결제 유도)

### 입출력 인터페이스

**클라이언트 → Spring** (`docs/04-api-spec.md`)

Phase A 구현 DTO (현재 동작):
```
POST /v1/routes/generate
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "destination": "부산",
  "startDate": "2026-07-10",
  "endDate": "2026-07-12",
  "groupType": "friends",        // solo / couple / friends / family
  "budgetLevel": "mid",          // budget / mid / premium
  "tags": ["먹방", "힐링"]        // 선택, 없으면 빈 배열
}

← 200 text/event-stream
event:route_id
data:{uuid}

data:{"day":1,"order":1,"place_id":"...","place_name":"...","tip":"...","duration_minutes":90,"budget_estimate":15000}
...
```

Phase B+ 추가 예정 필드 (docs/04-api-spec.md 전체 스펙):
```json
"density": "normal",            // Phase B (OR-Tools TSP 파라미터)
"transportMode": "transit",     // Phase B
"anchorPlaces": ["place-uuid"], // Phase B
"includeHiddenGems": true       // Phase B (Hidden Gems 기능 연기)
```

**Spring → FastAPI** (내부)
```
POST http://cloumy-ai:8000/ai/routes/generate
X-Internal-Key: {INTERNAL_API_KEY}

← application/x-ndjson 스트리밍
```

### 엣지 케이스 & 처리

| 케이스 | 처리 방법 |
|--------|-----------|
| LLM이 없는 place_id 반환 | DB 재검증 → pgvector 유사도로 대체 장소 삽입 |
| 후보 장소 20개 미만 | 반경 20km → 50km 자동 확장, 카카오 로컬 API 보충 |
| 트립 패스 없는 사용자 | 생성은 정상 수행, 저장 단계에서 403 반환 |
| 예산 미입력 | 예산 필터 스킵, 예상 비용 합산만 제공 |
| 동일 조건 재요청 | Redis 캐시 반환 (TTL 24시간) |
| 우천 예보 포함 날짜 | OpenWeatherMap API → 실외 장소 가중치 하향 (API 장애 시 graceful fallback) |
| FastAPI 장애 | 1차 Redis 캐시 → 2차 DB 유사 루트 쿼리 → 3차 503 반환 |
| Rate Limit 초과 | 429 반환 (Spring Cloud Gateway, 사용자당 1분 3회) |
| 슬롯 대안 요청 (🔄) | `POST /ai/routes/slots/{slot_id}/alternatives` → Haiku가 동일 카테고리·위치 기반 대안 3개 반환 → 사용자 선택 → 인접 슬롯 이동시간만 재계산 (전체 TSP 재실행 X) |
| 핀 슬롯 대안 요청 | is_pinned=true 슬롯은 대안 추천 불가 → 409 반환 |

### 미정 사항 → 모두 결정 완료

| 항목 | 결정 |
|------|------|
| 스트리밍 프록시 방식 | SSE (Spring WebFlux Flux<ServerSentEvent>) |
| 날씨 API | OpenWeatherMap (국내·해외 통합, 무료 티어) — Week 7~8 포함, graceful fallback 필수 |
| Redis 캐시 키 설계 | `{destination}:{nights}:{sorted_tags}:{density}` (예산·앵커 제외) |
| 루트 생성 실패 폴백 | Redis 캐시 → DB 유사 루트 추천 → 503 |

### 기존 스펙 참조

- `docs/04-api-spec.md` — `POST /routes/generate` 요청/응답 확정
- `ai/spec.md` — LangChain + RAG 파이프라인 흐름, Prompt Caching 전략, 폴더 구조
- `docs/03-data-model.md` — routes, route_slots, places 스키마
- `planning/reference/data-sources.md` — TourAPI, 카카오 로컬 API, 기상청, 임베딩 상세

---

## 구현 계획

### 대상 스택 & 권장 스킬

| 스택 | 스킬 |
|------|------|
| FastAPI (LangChain + RAG + OR-Tools) | `fastapi-coder` |
| Spring Boot (SSE 프록시 + 저장 + 폴백) | `spring-coder` |
| DB 마이그레이션 (places, routes, route_slots) | `db-migrator` |

### 생성할 파일/항목

#### FastAPI (`cloumy-ai/`)

| 파일명 | 역할 |
|--------|------|
| `app/routes/route_gen.py` | `POST /ai/routes/generate` 스트리밍 엔드포인트 |
| `app/routes/slot_alternatives.py` | `POST /ai/routes/slots/{slot_id}/alternatives` — 슬롯 대안 3개 추천 |
| `app/services/rag_service.py` | RAG Retrieval — pgvector 유사도 + PostGIS 반경 + 태그 필터 병렬 검색 + 카테고리 쿼터 보장 |
| `app/services/tsp_service.py` | OR-Tools TSP 동선 최적화 (Google Maps Distance Matrix 활용) |
| `app/services/model_router.py` | LangChain + Haiku↔Sonnet 라우팅, Prompt Caching 적용 |
| `app/services/weather_service.py` | OpenWeatherMap 날씨 예보 조회 (국내·해외 통합, graceful fallback) |
| `app/services/fallback_service.py` | Redis 캐시 1차 → DB 유사 루트 2차 폴백 |
| `app/services/place_validator.py` | LLM 출력 place_id 재검증 + 유사 장소 교체 |
| `app/prompts/route_gen.txt` | 루트 생성 시스템 프롬프트 (Prompt Caching 대상) |
| `app/models/schemas.py` | RouteGenRequest / DaySlot / RouteGenResponse Pydantic 모델 |
| `app/config/database.py` | asyncpg + pgvector 연결 풀 |
| `app/config/settings.py` | Pydantic BaseSettings (전체 환경 변수) |
| `scripts/collect_tourapi.py` | TourAPI 배치 수집기 (20개 도시) |
| `scripts/collect_kakao.py` | 카카오 로컬 배치 수집기 (TourAPI와 동시 적재, 쿼터 보완) |
| `scripts/collect_naver_trend.py` | 네이버 블로그 검색 배치 수집기 — places.trend_score 주 1회 갱신 |
| `scripts/generate_embeddings.py` | OpenAI 임베딩 배치 생성 |

#### Spring Boot (`cloumy-backend/`)

| 파일명 | 역할 |
|--------|------|
| `trip/controller/RouteController.java` | `POST /routes/generate` — MVC SseEmitter + 가상 스레드 스트리밍 프록시 ✅ Phase A |
| `trip/service/RouteService.java` | 트립 패스 검증, FastAPI 위임, routes 저장 ✅ Phase A |
| `trip/service/AiServiceClient.java` | Java 21 HttpClient (blocking) + 가상 스레드로 FastAPI ndjson 스트리밍 호출 ✅ Phase A |
| `trip/dto/RouteGenRequest.java` | 루트 생성 요청 DTO (Phase A 필드: destination·startDate·endDate·groupType·budgetLevel·tags) ✅ Phase A |
| `trip/entity/Route.java` | Route 엔티티 (`trip/entity/` 패키지, `BaseEntity` 상속) ✅ Phase A |
| `trip/repository/RouteRepository.java` | routes CRUD ✅ Phase A |
| `trip/service/FallbackRouteService.java` | 유사 루트 DB 쿼리 (폴백 2차) — Phase B+ |
| `trip/repository/RouteSlotRepository.java` | route_slots 배치 INSERT — Phase B+ |
| `trip/entity/RouteSlot.java` | RouteSlot 엔티티 — Phase B+ |
| `common/config/RedisConfig.java` | RedisTemplate 빈 (폴백 캐시 조회용) — Phase B+ |

#### DB Migration

| 파일명 | 역할 |
|--------|------|
| `V1__create_places.sql` | places 테이블, PostGIS GIST 인덱스, GIN 태그 인덱스 |
| `V2__create_routes.sql` | routes 테이블 |
| `V3__create_route_slots.sql` | route_slots 테이블 |
| `V4__enable_pgvector.sql` | `CREATE EXTENSION vector`, ivfflat 인덱스 생성 |

### 주요 기술 결정

- **LangChain 오케스트레이션**: `ChatAnthropic` (스트리밍) + `PromptTemplate` (Prompt Caching) + `RunnableSequence`로 전체 파이프라인 구성. 챗봇과 동일한 LangChain 패턴 → 코드 재사용
- **RAG Retrieval 3-way 병렬**: pgvector 유사도 + PostGIS 반경 + 태그 필터를 `asyncio.gather`로 병렬 실행 → 검색 레이턴시 최소화
- **SSE 선택 (WebSocket 아님)**: 루트 생성은 단방향. WebSocket은 챗봇에만 사용해 역할 분리
- **asyncpg 직접 사용**: pgvector `<=>` 연산자 + `ST_DWithin` 커스텀 쿼리 최적화 필요 → SQLAlchemy async 대신 asyncpg 직접 연결
- **OR-Tools 거리 행렬**: 직선 거리 아닌 Google Maps Distance Matrix API로 실제 이동 시간 사용. 장소 최대 25개 제한 (API 1회 요청 한도)
- **환각 방지 2단계**: ① 프롬프트에 "제공된 place_id만 사용" 명시 ② 출력 후 DB 재검증 → 없는 ID는 pgvector 유사도로 교체
- **기상청 graceful fallback**: try/except 감싸고 API 장애 시 날씨 가중치 스텝 스킵 → 루트 생성 항상 완료
- **Spring MVC + SseEmitter + Java 21 가상 스레드** (Phase A 실제 구현): WebFlux 없이 Spring MVC `SseEmitter` + `Executors.newVirtualThreadPerTaskExecutor()`로 구현. Java 21 가상 스레드가 blocking I/O를 처리하므로 WebClient/WebFlux 불필요 — AiServiceClient가 `HttpClient.send()` blocking 호출을 가상 스레드 안에서 안전하게 실행

### 인터페이스 계약

```
React Native
  → POST /v1/routes/generate (SSE, Spring)
  ← text/event-stream: event:route_id → data 청크 (ndjson 라인)

Spring RouteController (MVC SseEmitter + 가상 스레드) ✅ Phase A 구현
  → createRoute(): 패스 검증 + Route DB 저장 (executor 밖, 동기 실행)
  → 가상 스레드에서 AiServiceClient.streamRoute() 호출
  → POST http://cloumy-ai:8000/ai/routes/generate (Java 21 HttpClient blocking)
  ← application/x-ndjson (라인별 onLine 콜백 → SseEmitter.send)

FastAPI route_gen.py ✅ Phase A 구현
  → Haiku LCEL 체인: themes → category_tags 추출
  → PostgisTagRetriever: ST_DWithin + category_tags && (asyncpg)
  → Anthropic SDK 직접 스트리밍: Sonnet 4.6 (Prompt Caching 안정 적용)
    ※ LCEL route_chain.astream() 아닌 SDK 직접 사용 — cache_control 안정성
  → ndjson 라인 스트리밍 (StreamingResponse)

  Phase B+ 추가 예정:
  → rag_service: pgvector PgvectorRetriever + 카카오 로컬 API
  → weather_service: OpenWeatherMap
  → tsp_service: OR-Tools + Google Maps Distance Matrix
  → place_validator: pgvector DB 재검증
  → Redis: 캐시 조회

Spring RouteService (Phase A)
  → RouteRepository: routes INSERT

  Phase B+ 추가 예정:
  → RouteSlotRepository: route_slots 배치 INSERT
  → RedisTemplate: 폴백 1차 캐시 조회
  → FallbackRouteService: 유사 루트 DB 쿼리 (폴백 2차)
```

### 의존성 & 선행 조건

- [ ] Docker Compose 환경 구성 완료 — EC2 t3.large, PostgreSQL + PostGIS + pgvector, Redis (`planning/reference/infrastructure.md` 참조)
- [ ] DB 마이그레이션 V1~V4 완료 (places, routes, route_slots 테이블)
- [ ] TourAPI 데이터 수집 완료 — 최소 1개 도시 places 데이터 확보
- [ ] pgvector 임베딩 생성 완료 — places.embedding 컬럼 채우기
- [ ] JWT 인증 미들웨어 완료 (Spring) — 루트 생성 API 인증 필수
- [ ] 트립 패스 검증 로직 완료 — users.pass_type + pass_expires_at 확인
- [ ] API 키 발급 완료 — Anthropic, OpenAI, 카카오, Google Maps, OpenWeatherMap, 네이버 블로그 검색
- [ ] 장소 피드 API 구현 완료 — `GET /v1/places`, `GET /v1/places/{id}`, 북마크 API (북마크 기능 의존성)
- [ ] TourAPI + 카카오 배치 수집 완료 — places 테이블에 두 소스 혼합 적재 후 루트 생성 가능

### 예상 소요 시간

| 작업 | 기간 |
|------|------|
| DB 마이그레이션 + 데이터 파이프라인 (Week 3~4) | 2주 |
| LangChain + RAG + TSP + 루트 생성 MVP (Week 5~6) | 2주 |
| 기상청 연동 + 폴백 + 환각 방지 완성 (Week 7~8) | 2주 |
| **합계** | **6주** (선행 조건 완료 기준) |

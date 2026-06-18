---
feature: AI 루트 생성
stack: ai + backend + db
status: planned
created: 2026-06-08
---

# AI 루트 생성 구현 계획서

## 기능 요약

사용자가 목적지·날짜·인원·여행 스타일을 3단계로 입력하면, FastAPI AI 서비스가 LangChain + RAG(pgvector) + OR-Tools TSP + Claude Sonnet 4.6을 통해 Day별 최적 여행 루트를 생성하고, Spring Boot가 SSE 스트리밍으로 클라이언트에 반환한다. 생성된 루트는 PostgreSQL에 저장되며, 트립 패스 없는 사용자는 미리보기만 가능하다.

---

## PRD 구체화

### 정확한 동작 범위

**[입력 — 3단계 플로우]**
- Step 1: 목적지 선택 — MVP: 5개 핵심 여행지 (제주, 부산, 서울, 경주, 강릉) / 베타 출시 전: 국내 20개 도시 확장
- Step 2: 날짜(시작/종료) + 그룹 구성(혼자/커플/친구들/가족) + 예산 수준(가성비/중간/프리미엄)
  - ※ 가족 그룹은 MVP에서 단일 옵션으로 처리, 이후 '부모님과 함께 / 아이와 함께' 세분화 예정
- Step 3: 여행 스타일 태그(체크박스 복수 선택) + [선택] 교통수단(대중교통/렌터카/도보) / 숙소 위치(동선 최적화 기준점) / 하루 활동량(여유/보통/빡빡) + 앵커 장소(선택) + Hidden Gems 포함 여부

**[AI 처리 — FastAPI + LangChain + RAG]**
1. LangChain → Haiku: 검색 키워드 생성 ("부산 먹방 해산물" 등)
2. RAG Retrieval: pgvector 유사도 검색(OpenAI 임베딩) + PostGIS 반경 검색 + 태그 필터 병렬 실행 → 후보 50~100개
3. 카카오 로컬 API: 후보 20개 미만 시 실시간 보충
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
```
POST /v1/routes/generate
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "destination": "부산",
  "startDate": "2026-07-10",
  "endDate": "2026-07-12",
  "peopleCount": 2,
  "tags": ["먹방", "힐링"],
  "density": "normal",
  "totalBudget": 300000,
  "anchorPlaces": ["place-uuid-1"],
  "includeHiddenGems": true
}

← 200 text/event-stream (SSE, Day별 JSON chunk)
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
| `app/services/rag_service.py` | RAG Retrieval — pgvector 유사도 + PostGIS 반경 + 태그 필터 병렬 검색 |
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
| `scripts/collect_kakao.py` | 카카오 로컬 보충 수집기 |
| `scripts/generate_embeddings.py` | OpenAI 임베딩 배치 생성 |

#### Spring Boot (`cloumy-backend/`)

| 파일명 | 역할 |
|--------|------|
| `trip/controller/RouteController.java` | `POST /routes/generate` — SSE 스트리밍 프록시 |
| `trip/service/RouteService.java` | 트립 패스 검증, FastAPI 위임, routes/route_slots 저장 |
| `trip/service/AiServiceClient.java` | WebClient로 FastAPI 스트리밍 호출 |
| `trip/service/FallbackRouteService.java` | 유사 루트 DB 쿼리 (폴백 2차) |
| `trip/repository/RouteRepository.java` | routes CRUD + 유사 루트 쿼리 (tags 배열 겹침) |
| `trip/repository/RouteSlotRepository.java` | route_slots 배치 INSERT |
| `trip/domain/Route.java` | Route 엔티티 |
| `trip/domain/RouteSlot.java` | RouteSlot 엔티티 |
| `common/config/WebFluxConfig.java` | WebClient 빈, 타임아웃 설정 |
| `common/config/RedisConfig.java` | RedisTemplate 빈 (폴백 캐시 조회용) |

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
- **Spring WebFlux 혼용**: 기존 MVC 모놀리식에서 RouteController만 WebFlux로 작성. 나머지 MVC 유지

### 인터페이스 계약

```
React Native
  → POST /v1/routes/generate (SSE, Spring)
  ← text/event-stream: Day별 JSON chunk

Spring RouteController (WebFlux)
  → POST http://cloumy-ai:8000/ai/routes/generate (WebClient 스트리밍)
  ← application/x-ndjson

FastAPI route_gen.py
  → rag_service: pgvector (asyncpg) + 카카오 로컬 API
  → weather_service: 기상청 API
  → tsp_service: OR-Tools + Google Maps Distance Matrix
  → model_router: LangChain → Claude Sonnet 4.6 스트리밍
  → place_validator: pgvector DB 재검증
  → Redis: 캐시 조회 (aioredis)

Spring RouteService (저장 & 폴백)
  → RouteRepository: routes INSERT
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
- [ ] API 키 발급 완료 — Anthropic, OpenAI, 카카오, Google Maps, 기상청

### 예상 소요 시간

| 작업 | 기간 |
|------|------|
| DB 마이그레이션 + 데이터 파이프라인 (Week 3~4) | 2주 |
| LangChain + RAG + TSP + 루트 생성 MVP (Week 5~6) | 2주 |
| 기상청 연동 + 폴백 + 환각 방지 완성 (Week 7~8) | 2주 |
| **합계** | **6주** (선행 조건 완료 기준) |

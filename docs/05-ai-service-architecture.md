# AI 서비스 구조·흐름 (실제 구현 기준)

> **이 문서는 `ai/spec.md`(구현 전 계획 문서)와 다릅니다.** 2026-07-01 기준 실제 코드를 직접 읽고 검증한 "as-built" 문서이며, spec.md에 있지만 아직 구현 안 된 기능은 [9장](#9-specmd와의-차이-계획-대비-진행-상황)에 정리했습니다.

## 한눈에 보기

```
클라이언트 요청
   │
   ▼
[route_gen.py]  X-Internal-Key 인증 → 스키마 검증 → 도시 체크
   │
   ▼
[route_service.stream_route()]   ← 전체 오케스트레이션의 심장부
   │
   ├─ 1. Redis 캐시 히트?  ──Yes──▶ 즉시 반환 (LLM/DB 호출 없음)
   │        │ No
   ▼
   2. 후보 장소 검색 (Pgvector 임베딩 검색 → 실패 시 PostGIS 태그 검색 폴백)
   ▼
   3. Day별 날씨 예보 조회 (강수확률 텍스트로 만들어 Sonnet 프롬프트에 직접 삽입)
   ▼
   4. Sonnet 스트리밍 생성 → 한 줄(JSON) 완성될 때마다 검증 후 즉시 클라이언트로 전송
   ▼
   5. (스트리밍 종료 후) TSP로 day별 동선 재정렬 → Redis에 캐시 저장
```

**핵심 성격**: LangChain은 검색기(Retriever) 통일용으로만 쓰고 LLM 호출은 Anthropic SDK 직접 사용 · 모든 외부 의존성(LLM/임베딩/날씨/Redis/TSP)은 실패해도 서비스가 죽지 않도록 폴백 처리됨.

## 목차
1. [구조 개요](#1-구조-개요)
2. [요청 처리 흐름](#2-요청-처리-흐름)
3. [서비스 간 의존관계도](#3-서비스-간-의존관계도)
4. [LangChain 사용 범위](#4-langchain-사용-범위)
5. [DB / Redis 사용처](#5-dbpostgresql--postgis--pgvector--redis-사용처)
6. [backend 연동 지점](#6-backend-연동-지점)
7. [배치 스크립트 파이프라인](#7-배치-스크립트-파이프라인)
8. [설계 이유 요약](#8-설계-이유-요약)
9. [spec.md와의 차이](#9-specmd와의-차이-계획-대비-진행-상황)

---

## 1. 구조 개요

```
ai/
├── app/
│   ├── main.py                     # FastAPI 진입점 — lifespan, 인증 미들웨어, 라우터 등록
│   ├── config/
│   │   ├── settings.py             # pydantic-settings 환경변수 로딩
│   │   ├── database.py             # asyncpg 커넥션 풀 + pgvector 코덱 등록
│   │   ├── redis.py                # redis.asyncio 클라이언트 팩토리
│   │   └── city_centers.py         # 지원 도시 → (lon, lat) 상수
│   ├── models/
│   │   └── schemas.py              # RouteGenRequest (요청 스키마 + validator)
│   ├── routes/
│   │   ├── route_gen.py            # POST /ai/routes/generate — NDJSON 스트리밍
│   │   └── slot_alternatives.py    # POST /ai/routes/slots/alternatives — Haiku 단발 호출
│   └── services/
│       ├── route_service.py        # stream_route — 핵심 오케스트레이션
│       ├── retrievers.py           # PostgisTagRetriever, PgvectorRetriever
│       ├── tsp_service.py          # OR-Tools 기반 day별 동선 재정렬
│       ├── place_validator.py      # place_id 환각 검증/치환
│       └── weather_service.py      # OpenWeatherMap 기반 Day별 강수확률 텍스트 생성
├── scripts/                        # 앱 서버와 독립 실행되는 배치 파이프라인
│   ├── collect_tourapi.py          # 시드 데이터 수집 (TourAPI, 1회성)
│   ├── collect_kakao.py            # 보충 수집 + 좌표 교정 (Kakao Local API)
│   └── generate_embeddings.py      # OpenAI Batch API로 pgvector embedding 컬럼 채움
└── tests/                          # route_service / tsp_service / place_validator 단위 테스트
```

**설계 패턴**: `app/services/`는 클래스 없이 **순수 함수**로 작성됩니다. FastAPI `Depends` 대신 `request.app.state.db` / `request.app.state.redis`로 리소스에 직접 접근합니다(`app/main.py:21-22`).

> 왜? → `tests/test_route_service.py`에서 `MagicMock()`을 인자로 그냥 넘겨 서비스 함수를 FastAPI 없이 독립적으로 테스트할 수 있습니다.

---

## 2. 요청 처리 흐름

### 2-1. `POST /ai/routes/generate` (핵심 흐름)

**진입 단계** (`route_gen.py`)

| # | 단계 | 코드 위치 | 내용 |
|---|------|-----------|------|
| 1 | 인증 | `main.py:39-53` | 모든 요청의 `X-Internal-Key` 헤더를 `settings.internal_api_key`와 비교, 불일치 시 403. `/health`만 예외 |
| 2 | 검증 | `models/schemas.py:7-28` | Pydantic이 body를 `RouteGenRequest`로 파싱. `nights`(1~5), `hidden_gem_ratio`(0.0~1.0) 범위 위반 시 자동 422 |
| 3 | 도시 체크 | `route_gen.py:16-23` | `req.city not in CITY_CENTERS`면 400 |
| 4 | 스트리밍 래핑 | `route_gen.py:28-41` | `stream_route()` 제너레이터를 그대로 `yield`. `media_type="application/x-ndjson"` + `X-Content-Type-Options: nosniff` |

> **연결 종료 처리**: 클라이언트가 연결을 끊으면 `GeneratorExit`를 잡아 `gen.aclose()`를 명시 호출합니다. 이렇게 해야 Anthropic SDK 내부 HTTP 스트림이 정상 종료됩니다.

**`stream_route()` 내부 단계** (`route_service.py:70-203`)

| # | 단계 | 코드 위치 | 내용 |
|---|------|-----------|------|
| 1 | 캐시 조회 | `:76-86` | `redis.get(cache_key)` 히트 시 저장된 NDJSON을 줄 단위로 즉시 반환, LLM/DB 호출 스킵 |
| 2 | RAG 후보 조회 | `:92-108` | `PgvectorRetriever` 시도 → 예외(OpenAI 오류 등) 시 `PostgisTagRetriever`로 폴백 |
| 3 | Day별 날씨 예보 | `build_weather_forecast_text()` 호출 | Day별 강수확률 텍스트를 만들어 user_message에 삽입 → Sonnet이 후보 태그와 대조해 day별로 실내/야외 직접 판단, 실패 시 빈 문자열(날씨 문구 없이 진행) |
| 4 | 0건 조기 차단 | `:121-124` | 후보 없으면 에러 한 줄만 반환하고 Sonnet 호출 자체를 막음 |
| 5 | Sonnet 스트리밍 | `:156-191` | 델타 텍스트 수신 → `\n` 나올 때마다 완성된 JSON 한 줄을 잘라 `validate_route_slot()` 검증 후 즉시 `yield` |
| 6 | 연결 종료 처리 | `:186-188` | 클라이언트 연결 종료 시 `return`으로 종료 — **부분 수집분은 캐시에 저장하지 않음** |
| 7 | TSP 재정렬 | `:193-195` | 스트리밍이 끝난 뒤 `reorder_slots()`로 day별 재배열 |
| 8 | 캐시 저장 | `:198-203` | TSP 재정렬된 결과를 `setex(key, 86400, ...)`로 저장 (TTL 24h) |

**캐시 키 형식** (`_cache_key()`, `:64-67`):
```
route:{city}:{nights}:{group_type}:{budget_level}:{themes 정렬join}:{ratio:.1f}
```
테마 순서를 `sorted()`로 정규화해, 조건이 같으면 항상 같은 키가 되도록 합니다.

> ⚠️ **비대칭성 주의**
> 최초 요청(cache miss)에서 클라이언트가 실시간으로 받는 스트림은 **LLM 원본 순서**이고, TSP 재정렬은 스트림이 끝난 뒤에만 수행되어 **Redis 캐시에만** 반영됩니다. 즉 같은 조건이라도 최초 응답과 캐시 히트 응답의 슬롯 `order` 값이 다를 수 있습니다.
> → TSP는 day 전체 좌표가 모여야 계산 가능하므로 구조적으로 스트리밍 도중엔 적용 불가. 실시간성과 캐시 재사용 품질을 동시에 만족시키기 위한 트레이드오프로 보입니다.

> 📝 **날씨 반영 방식 변경 이력 (2026-07-02)**
> 이전에는 여행 기간 전체 강수확률 **평균**으로 모든 후보 장소에 동일한 가중치(야외 0.3배/실내 1.5배)를 매겨 정렬하는 방식이었음. 이 시점엔 아직 day 배정이 안 돼 있어 "여행 중 하루만 비가 와도 전체가 실내 위주로 쏠리는" 부정확함이 있었음.
> → 지금은 Day별 강수확률을 텍스트로 만들어 `user_message`에 직접 삽입(`weather_service.build_weather_forecast_text()`)하고, `ROUTE_GEN_SYSTEM_PROMPT`의 `[날씨 반영]` 규칙과 함께 Sonnet이 각 후보 태그(`candidates_text`의 "태그: ...")와 day별 예보를 직접 대조해 배치하도록 위임. `user_message`는 애초에 후보 리스트를 포함해 매 요청 100% 비캐시라서 이 변경이 프롬프트 캐싱 효율에 주는 영향은 없음(캐시는 `ROUTE_GEN_SYSTEM_PROMPT`에만 적용) — Day별 날씨 텍스트 추가분은 후보 50곳 텍스트(약 2,500~3,500 토큰) 대비 약 100~135 토큰(＋3.8%)으로 무시할 수준.

### 2-2. `POST /ai/routes/slots/alternatives` (단발 요청)

`slot_alternatives.py:64-103`의 흐름:

```
요청 파싱 → 예산/태그/인접 슬롯 텍스트 조립
   → _anthropic.messages.create(model="claude-haiku-4-5-20251001") 논스트리밍 호출
   → 마크다운 코드블록 제거 → json.loads 파싱
   → 실패 시 로그만 남기고 빈 리스트 반환
```

`route_service._anthropic` 싱글턴을 그대로 import해서 재사용합니다(`:9`).

---

## 3. 서비스 간 의존관계도

```
app/main.py
 ├─ lifespan: create_pool() → app.state.db / create_redis() → app.state.redis
 ├─ internal_key_middleware (X-Internal-Key, /health 제외)
 ├─ route_gen.router
 └─ slot_alternatives.router

route_gen.py ──▶ route_service.stream_route(req, db, redis)
slot_alternatives.py ──▶ route_service._anthropic (싱글턴 재사용, Haiku)

route_service.py (오케스트레이터)
 ├─ 모듈 싱글턴: _anthropic(AsyncAnthropic), _openai(AsyncOpenAI)
 ├─ 1) Redis 캐시 조회
 ├─ 2) retrievers.PgvectorRetriever ──(실패시 폴백)──▶ retrievers.PostgisTagRetriever
 ├─ 3) weather_service.build_weather_forecast_text() — Day별 강수확률 텍스트만 생성(후보 정렬 안 함)
 ├─ 4) _anthropic.messages.stream() — Sonnet, LangChain 미사용
 ├─ 5) place_validator.validate_route_slot() — 줄 단위 환각 검증
 ├─ 6) tsp_service.reorder_slots() — 스트리밍 완료 후 실행
 └─ 7) Redis 캐시 저장

retrievers.py
 ├─ PostgisTagRetriever — asyncpg.Pool.fetch(ST_DWithin + category_tags &&)
 └─ PgvectorRetriever   — AsyncOpenAI.embeddings + asyncpg(ST_DWithin + embedding <=> 유사도)
    (둘 다 langchain_core.retrievers.BaseRetriever 상속, 서로 교체 가능한 ainvoke() 인터페이스)

tsp_service.py / weather_service.py / place_validator.py
 └─ 모두 route_service에서만 호출되는 독립 순수 함수 모듈

backend (Spring Boot) — AiServiceClient.java
 ├─ streamRoute(): HTTP/1.1 강제 + X-Internal-Key, 120초 타임아웃, 동일 cacheKey로 Redis 선조회
 └─ getSlotAlternatives(): X-Internal-Key, 30초 타임아웃

scripts/ (오프라인 배치)
 collect_tourapi.py → collect_kakao.py → generate_embeddings.py 순서로 places 테이블 채움
```

---

## 4. LangChain 사용 범위

`ai/CLAUDE.md`에 명시된 원칙: **"LangChain Core, `BaseRetriever`만 사용, 체인/에이전트 미사용"** — 실제 코드와 일치합니다.

**쓰는 부분**
- `retrievers.py:5-6`에서 `langchain_core.documents.Document`, `langchain_core.retrievers.BaseRetriever`만 import
- `PostgisTagRetriever` / `PgvectorRetriever` 모두 `BaseRetriever`를 상속한 Pydantic 모델(`ConfigDict(arbitrary_types_allowed=True)`로 `asyncpg.Pool`, `AsyncOpenAI` 등 임의 타입 필드 허용)
- 둘 다 `_aget_relevant_documents`만 구현하고, 동기 버전은 `NotImplementedError`로 명시적으로 막음
- 호출부(`route_service.py:100`)는 `retriever.ainvoke()`라는 LangChain 표준 인터페이스로 결과를 받음

**안 쓰는 부분**
- LLM 호출 자체는 LangChain 체인이 아니라 **Anthropic SDK(`AsyncAnthropic`)를 직접 스트리밍 호출**(`route_service.py:157-168`)
- 프롬프트도 `ChatPromptTemplate` 없이 순수 문자열 포맷팅

**왜 이렇게 나뉘었나 (추정)**
| 필요 | 선택 | 이유 |
|---|---|---|
| 델타 텍스트 줄 단위 검증·스트리밍, Prompt Caching 세밀 제어 | SDK 직접 호출 | LangChain 체인 추상화보다 로우레벨 제어가 유리 |
| 태그 검색 / 벡터 검색, 두 이질적 전략을 교체 가능하게 | Retriever 추상화만 재사용 | `ainvoke()`로 통일해두면 `try/except` 한 줄로 폴백 구현 가능 |

---

## 5. DB(PostgreSQL + PostGIS + pgvector) / Redis 사용처

### PostgreSQL / PostGIS / pgvector

- **커넥션 풀** (`config/database.py:12-19`): `min_size=2, max_size=10, command_timeout=5`. 모든 새 커넥션마다 `register_vector(conn)`을 호출(`_init_connection`)하지 않으면 `embedding <=> $1` 쿼리에서 타입 에러가 난다고 주석에 명시.
- **PostgisTagRetriever** (`retrievers.py:13-98`): `ST_DWithin` 반경 검색 + `category_tags &&` 배열 교집합 필터, `ORDER BY RANDOM() LIMIT 50`.
  - 후보 0건 → 반경 30km→50km 확장(`:71-73`)
  - 그래도 0건 → 태그 필터 제거 후 재시도(`:76-78`) — **3단계 완화 폴백**
- **PgvectorRetriever** (`retrievers.py:118-143`): 트랜잭션 내 `SET LOCAL ivfflat.probes = 10`(기본값 1보다 recall 우선) 후 `ORDER BY embedding <=> $1::vector`로 유사도 검색. 반경 확장 폴백만 있고 태그 폴백은 없음(벡터 검색엔 태그 개념이 없으므로).

### Redis

- **클라이언트** (`config/redis.py:5-7`): `aioredis.from_url(decode_responses=True)`, lazy 연결
- **용도**: 루트 생성 캐시(`route_service.py:76-86`, `197-203`)뿐 — 코드상 다른 용도는 없음
- **오류 처리**: Redis 오류는 로그만 남기고 캐시 없이 정상 동작 (graceful degradation)
- **backend와 캐시 공유**: Spring `AiServiceClient.cacheKey()`가 FastAPI와 동일한 키 포맷을 사용해 FastAPI 호출 전에 Redis를 먼저 확인(`AiServiceClient.java:42, 115-117`) → 캐시 히트 시 FastAPI 호출 자체를 생략하는 **이중 방어 구조**

> ⚠️ **캐시 키에 user_id 없음 — 개인화 확장 시 주의**
> `_cache_key()`(`route_service.py:64-67`)는 `city, nights, group_type, budget_level, themes, hidden_gem_ratio`만으로 키를 만들고 유저를 구분하지 않는다. 즉 서로 다른 유저가 동일 조합으로 요청하면 같은 캐시(따라서 같은 루트)를 공유한다.
> 지금은 입력값이 적어 문제가 드러나지 않지만, 향후 사용자 프로필/선호 이력 등 개인화 입력이 늘어나면 이 캐시 키가 그 시그널을 반영하도록 재설계하거나, 개인화가 강하게 들어가는 요청은 캐시를 우회해야 한다. 캐시 키 포맷을 바꾸면 backend `AiServiceClient.cacheKey()`도 동일하게 맞춰야 한다(위 항목 참고).

### 기타

- **lifespan 정리** (`main.py:26-28`): `db.close()` → `redis.aclose()` → `close_ai_clients()`(Anthropic/OpenAI httpx 클라이언트 종료) 순서
- **헬스체크** (`main.py:60-71`): `/health`에서 `SELECT 1`로 DB 연결 확인, 실패 시 503

---

## 6. backend 연동 지점

| 항목 | 내용 |
|---|---|
| 인증 | 공개 API가 아닌 내부 마이크로서비스이므로 JWT 대신 단순 shared-secret(`X-Internal-Key`) 헤더 비교(`main.py:45-51`) |
| HTTP 버전 | `AiServiceClient.java:39` `.version(HttpClient.Version.HTTP_1_1)` — uvicorn이 HTTP/2 미지원이라 강제로 낮춤 |
| 타임아웃 | 루트 생성 120초 (LLM이 여러 슬롯 순차 생성) / 슬롯 대안 30초 (단발 짧은 응답) |
| 환경변수 | `ai/.env.example`에 "루트 .env의 INTERNAL_API_KEY와 동일한 값" 주석 — 두 서비스가 동일 값을 각자 `.env`에 중복 보관 |

---

## 7. 배치 스크립트 파이프라인

실행 순서 의존관계: **collect_tourapi → collect_kakao → generate_embeddings**

1. **`collect_tourapi.py`** — 1회성 시드 데이터 수집. 한국관광공사 TourAPI에서 지역 코드 × contentTypeId 조합으로 페이지네이션 수집 후 `source='tourapi'`로 bulk INSERT.
2. **`collect_kakao.py`** — TourAPI가 놓친 맛집/카페/핫플을 카카오 로컬 API(카테고리+키워드 검색)로 보강.
   - 반경 150m 내 유사 장소 발견 + TourAPI 좌표가 100m 이상 어긋남 → 좌표 교정(UPDATE)
   - 그 외 발견 → skip / 미발견 → `source='kakao'`로 INSERT
   - 실행 후 "새로 삽입된 장소는 embedding=NULL이므로 generate_embeddings 실행 필요" 안내 로그 출력
3. **`generate_embeddings.py`** — `embedding IS NULL` 행을 OpenAI Batch API(개별 호출 대비 저렴)로 일괄 임베딩 생성 후 `UPDATE places SET embedding=...`. 배치 ID를 파일로 저장해 중간 실패 시 재실행해도 기존 배치를 재사용 가능.

> 이 파이프라인이 준비되어 있어야 `PgvectorRetriever`가 유사도 검색 결과를 낼 수 있습니다. 준비 전이거나 OpenAI 장애 시에도 `PostgisTagRetriever` 폴백으로 서비스 가용성은 유지됩니다.

---

## 8. 설계 이유 요약

| # | 설계 | 이유 |
|---|---|---|
| 1 | 순수 함수 서비스 계층 + `app.state` 직접 접근 | FastAPI DI 없이 인자로 db/redis를 직접 넘겨, `MagicMock()`만으로 서비스 함수를 독립 테스트 가능(`tests/test_route_service.py`) |
| 2 | 다단계 graceful fallback 전반 적용 | Pgvector→PostGIS, 반경 확장, 태그 필터 제거, 날씨/Redis 오류 시 원본 유지, TSP 무해 시 원본 순서, place_id 환각 시 후보 치환 — 외부 의존성 하나가 실패해도 "항상 응답 가능"을 우선 |
| 3 | NDJSON 줄 단위 스트리밍 | LLM이 한 줄에 JSON 하나씩 생성하도록 강제 → 완성된 줄만 즉시 검증·전송. UX 개선 + 부분 파싱 실패 리스크 제거 + 슬롯 단위 환각 검증을 동시에 달성 |
| 4 | 모델 라우팅(Sonnet/Haiku) + Prompt Caching | 복잡한 다중 슬롯 JSON엔 Sonnet, 단발 저비용 응답엔 Haiku. 시스템 프롬프트에 `cache_control: ephemeral` 적용해 반복 호출 입력 비용 절감 |
| 5 | 내부 통신은 단순 shared-secret | backend(Spring)만 호출하는 내부 마이크로서비스라 JWT 같은 무거운 인증 불필요 |
| 6 | 배치 스크립트를 앱 서버와 완전 분리 | 대량 데이터 임베딩 생성은 오래 걸리고 중간 실패 가능 → 배치 ID 저장으로 재시작 안전성 확보 |

---

## 9. spec.md와의 차이 (계획 대비 진행 상황)

`ai/spec.md`에 설계되어 있으나 **아직 구현되지 않은** 항목:

| spec.md 항목 | 상태 |
|---|---|
| `routes/chatbot.py` (WebSocket `/ai/chat`) | 미구현 |
| `routes/embedding.py` (내부용 임베딩 API) | 미구현 — 임베딩은 `scripts/generate_embeddings.py` 배치로만 생성 |
| `routes/scoring.py` (희소성 점수 API) | 미구현 |
| `services/model_router.py` | 미구현 — 현재는 각 라우트가 모델명을 직접 하드코딩 |
| `services/fallback_service.py` (Redis 1차 → DB 유사 루트 2차 폴백) | 미구현 — 현재는 캐시 미스 시 곧바로 LLM 재생성 |
| `services/expense_parser.py` (자연어 지출 파싱) | 미구현 |
| `services/rarity_scorer.py` (희소성 점수 계산) | 미구현 |
| `prompts/*.txt` (프롬프트 외부 파일 분리) | 미구현 — 현재는 코드에 문자열로 인라인 |
| `services/rag_service.py` | 실제로는 `retrievers.py`로 이름·구조가 다르게 구현됨 |

> **현재 실제로 도는 것**: 루트 생성(`route_gen.py`)과 슬롯 대안 추천(`slot_alternatives.py`) 두 엔드포인트, 그리고 이를 지탱하는 RAG 검색 / 날씨 가중치 / TSP 재정렬 / 환각 검증. 챗봇, 예산 자연어 파싱, 희소성 점수는 아직 계획 단계입니다.

# 개발 흐름 참고서 — AI 루트 생성 중심

AI 루트 생성 기능을 중심으로 전체 개발 흐름, 기술 결정 근거, 서비스 간 통신을 정리한다.

---

## 1. 스트리밍 프록시 방식 결정 ✅

### 선택: SSE (Server-Sent Events) via Spring WebFlux

**흐름**:
```
클라이언트 (React Native)
  ↓ POST /routes/generate (HTTP)
Spring Boot (WebFlux)
  ↓ WebClient → POST /ai/routes/generate (Chunked HTTP)
FastAPI AI 서비스
  ↓ StreamingResponse (Day별 JSON chunk)
Spring Boot
  ↓ SseEmitter or Flux<ServerSentEvent>
클라이언트
  ← EventSource or fetch stream
```

**SSE를 선택한 이유**:
- 루트 생성은 **단방향** (서버 → 클라이언트). WebSocket의 양방향 오버헤드 불필요
- WebSocket은 챗봇(양방향 대화)에 사용 → 역할 명확히 분리
- Spring WebFlux `Flux<ServerSentEvent>` → 구현 5~10줄로 단순
- React Native에서 `EventSource` 라이브러리 또는 `fetch` + `ReadableStream`으로 수신 가능

**구현 패턴** (Spring WebFlux):
```java
// RouteController.java
@PostMapping(value = "/routes/generate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<String>> generateRoute(@RequestBody RouteGenRequest req) {
    return aiServiceClient.streamRoute(req)
        .map(chunk -> ServerSentEvent.builder(chunk).build());
}
```

**구현 패턴** (FastAPI):
```python
# route_gen.py
@router.post("/ai/routes/generate")
async def generate_route(req: RouteGenRequest):
    return StreamingResponse(
        stream_route_generation(req),
        media_type="application/x-ndjson"  # Newline-delimited JSON
    )
```

---

## 2. 루트 생성 실패 시 폴백 — 유사 루트 추천 ✅

**폴백 트리거**:
- FastAPI 서비스 다운 (Connection refused)
- LLM API 타임아웃 (10초 초과)
- 후보 장소 0개 (완전히 데이터 없는 지역)

**폴백 순서**:
```
1차: Redis 캐시에서 동일 목적지 최근 루트 반환 (TTL 내)
  ↓ 없으면
2차: PostgreSQL에서 유사 루트 쿼리
  - 동일 destination + 박수(±1) + 태그 겹침 2개 이상
  - is_public = true + save_count 내림차순
  - 최근 30일 내 생성된 루트 우선
  ↓ 없으면
3차: "현재 AI 서비스 점검 중입니다. 잠시 후 다시 시도해주세요." 오류 반환
```

**유사 루트 쿼리** (Spring):
```java
// RouteRepository.java
List<Route> findSimilarRoutes(String destination, int nights, List<String> tags, Pageable pageable);

// 실제 쿼리 (JPQL 또는 QueryDSL)
WHERE destination = :destination
  AND nights BETWEEN :nights - 1 AND :nights + 1
  AND tags && :tags   -- PostgreSQL 배열 겹침 연산자
  AND is_public = true
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY save_count DESC
LIMIT 3
```

---

## 3. Week별 개발 흐름

### Week 1~2: 환경 설정
```
[ ] Docker Compose 작성 (PostgreSQL + PostGIS + pgvector, Redis)
[ ] Spring Boot 프로젝트 초기화 (build.gradle, 패키지 구조)
[ ] FastAPI 뼈대 (main.py, 라우터 연결, 헬스체크 /health)
[ ] Claude API 연결 확인 (claude-sonnet-4-6 단순 호출 테스트)
[ ] GitHub Actions CI 설정 (lint + build only)
[ ] 환경 변수 정의 (.env.example)
```

### Week 3~4: 데이터 파이프라인
```
[ ] TourAPI 수집기 작성 (Python 스크립트)
    - 20개 도시 areaBasedList 전체 수집
    - detailCommon 병렬 요청 (asyncio + rate limit)
[ ] places 테이블 마이그레이션 (Flyway)
[ ] PostGIS 인덱스 생성
[ ] OpenAI 임베딩 배치 생성 (BackgroundTasks)
[ ] pgvector 인덱스 (ivfflat) 생성
[ ] 카카오 로컬 API 연동 (보충 수집)
```

### Week 5~6: AI 루트 생성 MVP
```
[ ] RAG 서비스 (rag_service.py)
    - pgvector 유사도 검색
    - PostGIS 반경 검색
    - 태그 필터
    - 카카오 API 보충
[ ] OR-Tools TSP 동선 최적화 (tsp_service.py)
[ ] Haiku로 검색 키워드 생성 (model_router.py)
[ ] Sonnet으로 루트 생성 프롬프트 (prompts/route_gen.txt)
[ ] Prompt Caching 적용
[ ] 환각 방지 검증 (place_id 재검증)
[ ] Spring → FastAPI HTTP 스트리밍 클라이언트
[ ] SSE 스트리밍 프록시 (Spring WebFlux)
[ ] routes + route_slots 저장 (Spring)
[ ] Redis 캐시 (동일 조건 재요청)
```

### Week 7~8: 품질 개선
```
[ ] 기상청 API 연동 (weather_service.py)
    - 여행 날짜 강수확률 조회
    - 실외/실내 장소 가중치 조정
[ ] 폴백 — 유사 루트 추천 (Spring)
[ ] Pin & Reshuffle (reshuffle.py, Haiku)
[ ] Rate Limiting 튜닝 (Spring Cloud Gateway)
[ ] 통합 테스트 (루트 생성 E2E)
```

---

## 4. 서비스 간 통신 상세

### 클라이언트 → Spring (공개 API)
```
POST /routes/generate
Authorization: Bearer {JWT}
→ Spring이 JWT 검증 → 트립 패스 확인 → FastAPI 호출
```

### Spring → FastAPI (내부 API)
```
POST http://cloumy-ai:8000/ai/routes/generate
X-Internal-Key: {INTERNAL_API_KEY}   ← Spring만 알고 있는 내부 키
→ JWT 없음 (이미 Spring에서 검증 완료)
```

### FastAPI 내부 의존성
```
FastAPI
  → PostgreSQL (pgvector 검색) — asyncpg 직접 연결
  → Redis (캐시 조회/저장) — aioredis
  → Anthropic API (Claude)
  → OpenAI API (임베딩 조회 — 신규 장소 있을 때만)
  → 카카오 로컬 API (후보 부족 시)
  → 기상청 API (여행 날짜 예보)
  → Google Maps Distance Matrix API (OR-Tools 거리 행렬)
```

---

## 5. Redis 역할 & 패턴 정리

### 5-1. 루트 결과 캐시 (FastAPI)

```python
# key 설계: route_cache:{destination}:{nights}:{sorted_tags}:{density}
# ※ 예산과 anchorPlaces는 키 제외 — 적중률 우선
# TTL: 24시간

cache_key = f"route_cache:{destination}:{nights}:{','.join(sorted(tags))}:{density}"

cached = await redis.get(cache_key)
if cached:
    return json.loads(cached)

result = await generate_with_llm(...)
await redis.setex(cache_key, 86400, json.dumps(result))
```

> 예산과 앵커 장소를 키에 제외하는 이유:  
> 동일 목적지·박수·태그 조합의 루트 골격은 같고, 예산은 클라이언트 필터로 표시만 다르게 처리 가능.  
> 앵커 장소 포함 시 캐시 키 폭발 → 적중률 0에 수렴.

### 5-2. 챗봇 세션 (FastAPI)

```python
# key: chat_session:{user_id}
# TTL: 24시간 (여행 기간 고려)
# 구조: JSON 직렬화

session = {
    "route_id": "uuid",
    "messages": [...],   # 최근 20개만 유지 (오래된 것 pop)
    "context": {
        "current_location": {"lat": 35.17, "lng": 129.07},
        "current_day": 2,
        "remaining_budget": 85000
    }
}
```

### 5-3. JWT 블랙리스트 (Spring)

```java
// 로그아웃 시 refresh token → Redis 블랙리스트에 추가
// key: jwt_blacklist:{jti}
// TTL: refresh token 만료 시간과 동일

redisTemplate.opsForValue().set(
    "jwt_blacklist:" + jti,
    "revoked",
    Duration.ofSeconds(remainingExpiry)
);
```

### 5-4. 그룹 여행 동기화 (Spring — P1)

```
Redis Pub/Sub
  channel: group_trip:{groupTripId}
  
메시지 형식: {"type": "slot_vote", "slotId": "uuid", "vote": "like", "userId": "uuid"}

Spring WebSocket Handler → Redis publish
Redis → 모든 Spring 인스턴스에 broadcast → 해당 그룹 WebSocket 클라이언트에 전달
```

### Redis 전용 스킬 필요 여부

> **불필요** — 이유:
> - 루트 캐시, 챗봇 세션, JWT 블랙리스트, Pub/Sub 모두 패턴이 명확하고 표준적
> - FastAPI에서는 `aioredis`, Spring에서는 `Spring Data Redis` + `RedisTemplate`로 처리
> - 각 기능의 `fastapi-coder`, `spring-coder` 스킬 실행 시 feature-*.md에 Redis 스키마 명시하면 충분
> - 별도 스킬로 만들면 다른 스킬과 중복 구현 위험만 있음

---

## 6. 환경 변수 전체 목록

> 환경 변수는 서비스별로 분리 관리. 자세한 발급 안내는 각 `.env.example` 주석 참고.

### FastAPI (`ai/.env`)
```bash
# DB — asyncpg 포맷
POSTGRES_URL=postgresql+asyncpg://cloumy:password@localhost:5432/cloumy

# Redis
REDIS_URL=redis://localhost:6379/0

# AI 모델
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...          # text-embedding-3-small 임베딩 생성용

# 외부 API
KAKAO_REST_API_KEY=...         # Kakao Local API (장소 검색, 보충)
GOOGLE_MAPS_API_KEY=...        # Distance Matrix API (OR-Tools TSP)
OPENWEATHERMAP_API_KEY=...     # 날씨 예보 (국내·해외 통합, 무료 1,000콜/일)
TOURAPI_KEY=...                # 한국관광공사 (장소 시드 데이터, 무료)
NAVER_SEARCH_CLIENT_ID=...     # 네이버 블로그 검색 (트렌딩 장소, Phase 1 후반)
NAVER_SEARCH_CLIENT_SECRET=...

# 내부 통신
INTERNAL_API_KEY=...           # Spring → FastAPI X-Internal-Key 헤더
```

### Spring Boot (루트 `.env`)
```bash
# DB — JDBC 포맷 (application.yml → ${POSTGRES_JDBC_URL})
POSTGRES_USER=cloumy
POSTGRES_PASSWORD=...
POSTGRES_JDBC_URL=jdbc:postgresql://localhost:5432/cloumy

# Redis (Spring Boot 는 host/port 분리)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=...
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=1209600

# 소셜 로그인 OAuth
KAKAO_CLIENT_ID=...            # REST API 키 (OAuth + Kakao Local API 공용)
KAKAO_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY=...
NAVER_CLIENT_ID / NAVER_CLIENT_SECRET=...

# 외부 API (Spring 에서도 직접 호출하는 경우)
KAKAO_REST_API_KEY=...         # KAKAO_CLIENT_ID 와 동일한 값
GOOGLE_MAPS_API_KEY=...

# 결제
TOSS_PAYMENTS_SECRET_KEY=...

# 내부 통신
INTERNAL_API_KEY=...
```

---

## 7. 핵심 외부 API 요금 & 한도 요약

| API | 무료 한도 | 초과 요금 | 비고 |
|-----|----------|----------|------|
| TourAPI | 무제한 (공공) | 없음 | 1일 1000건 권고 |
| 카카오 로컬 | 300,000 트랜잭션/월 | 유료 전환 | MVP MAU 1만이면 충분 |
| OpenAI 임베딩 | - | $0.02/1M tokens | 배치 시 $1~3 수준 |
| Claude Sonnet 4.6 | - | $3/$15 (in/out) /1M | 혼합+캐싱으로 월 $170~250 |
| Claude Haiku 4.5 | - | $0.80/$4 (in/out) /1M | - |
| Google Maps | $200 크레딧/월 | $7/1000 요청 | MAU 1만 기준 월 $100~200 예상 |
| 기상청 API | 무제한 (공공) | 없음 | 일 10,000건 한도 |

# 08. 코드베이스 가이드 — 무엇이 돌아가고, 어떻게 흐르는가

> **이 문서의 목적**: 코드를 근거로 ① 지금 무엇이 구현됐는지 ② 핵심 흐름이 어떻게 도는지를 한 자리에서 본다.
> 기준일 **2026-08-06** · 근거는 전부 코드에서 확인한 것 (문서 인용 아님)

이 문서는 **다른 문서가 비워둔 곳만** 채운다. AI 파이프라인은 `05`, 챗봇은 `06`이 이미 잘 다루므로 링크로 넘긴다.

---

## 0. 먼저 — 어느 문서를 믿을 수 있나

레포에 문서가 많지만 **층위가 다르다.** 이걸 모르고 읽으면 틀린 걸 사실로 믿게 된다(실제로 그런 일이 있었다).

| 문서 | 판정 | 믿어도 되나 |
|---|---|---|
| `06-ai-chatbot.md` | as-built | ✅ |
| `02`·`03`·`04`·`05` | 아키텍처 / DB / API / AI | ✅ **2026-08-06 코드 기준으로 전면 동기화** |
| `07-ios-device-testing.md` | 운영 가이드 | ✅ |
| `CLAUDE.md` × 4 (131줄) | 컨벤션·함정 | ✅ 짧고 정확 |
| `ai/tests/` (12파일 2,703줄) | 테스트 | ✅ **사실상 최신 명세** |
| `superpowers/specs`·`plans` (7,591줄) | 설계 근거 | ✅ "왜"의 원천 |
| `00`·`01` | 제품 기획 | ⚠️ 계획이지 현황 아님 |
| `architecture.svg` | 다이어그램 | ❌ **2026-06-09자.** Elasticsearch·socket.io·토스 — 전부 폐기된 결정. 아직 안 고쳤다 |

> 📌 **2026-08-06에 `02`·`03`·`04`·`05`를 코드 기준으로 다시 썼다.** 그전까지 이 표는 넷 다 ❌였다 — `03`은 V7~V21 8건이 누락돼 있었고, `04`는 31개만 적혀 있었으며(실제 52개), `02`는 안 쓰는 Spring Cloud Gateway·socket.io를 그려놨고, `05`는 라우터를 2개로 적어놨다(실제 6개).
> **남은 ❌는 `architecture.svg` 하나다.**

**규칙 하나**: 그래도 최종 판정은 **코드로 교차검증**한다. 문서는 항상 코드보다 늦는다.

---

## 1. 구현 현황

### 규모

| 서비스 | 파일 | 라인 |
|---:|---:|---:|
| Spring `backend/src/main/java` | 119 | 6,263 |
| FastAPI `ai/app` | 27 | 3,734 |
| React Native `frontend/{app,components,lib}` | 59 | 8,462 |

### 테스트 — 편차가 크다

| | 파일 | 라인 | 비고 |
|---|---:|---:|---|
| `ai/tests/` | 12 | **2,712** | `test_proactive_rules.py` 497줄이 최다 |
| `backend/src/test/` | 4 | 480 | 서비스만. **컨트롤러 테스트 0** |
| `frontend/` | **0** | 0 | **테스트 러너 자체가 없음** |

> AI 서비스만 실질적 테스트 자산이 있다. 역설적으로 그래서 `ai/tests/`가 stale 문서를 대신하는 **가장 정확한 명세**가 됐다.

### 돌아가는 것

| | 근거 |
|---|---|
| 소셜 로그인 4종 + JWT | `auth/oauth/` — 단 **Apple 서명 검증 미구현**(`unimplemented.md` 🔴) |
| AI 루트 생성 (RAG + TSP + 환각방지 + SSE) | `RouteController:216` · `route_service.py` |
| 슬롯 CRUD·재정렬·대안·이동수단 | `RouteSlotService`(570줄) |
| 여행 중 챗봇 (도구 3종 + 루트 삽입) | `chat_service.py` — 상세는 `06` |
| **프로액티브 개입 (규칙 9종)** | `proactive_service.py` — **앱 내 배너, 풀 방식** |
| 예산·지출·리포트 | `BudgetController` 7개 엔드포인트 |
| 커뮤니티 (공개 루트·북마크·클론) | `RouteController` |
| 탐색 탭 (PostGIS 반경) | `ExploreService` |
| 페르소나 태그 10종 | `PersonaTag.java` |
| 4개국어 (ko/en/ja/zh) | `lib/i18n/locales/` |
| 장소 데이터 21,543건 + 임베딩 | TourAPI 20,363 + 네이버 1,180 |

### 없는 것 — 착각하기 쉬운 것들

| | 실제 |
|---|---|
| **푸시 알림 (FCM/APNs)** | **소스 흔적 0건.** 프로액티브는 푸시가 아니라 **앱 진입 시 배너** |
| **스케줄러** | `@Scheduled` **0개.** 배치·주기 작업이 하나도 없다 |
| **여행 상태 필드** | `status` 컬럼 없음. **날짜 계산으로만** 판정 (`RouteService.getActiveRoute`) |
| **ODsay** | 안 씀. 대중교통은 **Tmap** (`transport_service.py:18`). ODsay는 2026-07-04 검토 후 배제 |
| Serper / KOPIS / `events` 테이블 | 전부 없음 → 콘서트 앵커 미구현 |
| 결제 | `PassValidationService` 33줄이 전부. PG 미연동 |
| `places.business_hours`·`trend_score` | 컬럼은 있는데 **값을 넣는 코드가 없다** |

---

## 2. 아키텍처

```
┌───────────────────────────────────────────────────────────┐
│  앱  Expo / React Native                                  │
│      expo-router · Zustand · TanStack Query               │
└──────────────────────────┬────────────────────────────────┘
                           │  JWT Bearer
                           ▼
┌───────────────────────────────────────────────────────────┐
│  Spring Boot 3.3.5 / Java 21          :8080               │
│  인증 · 소유권 검증 · 과금 가드 · 영속화 · SSE 중계        │
└───────┬───────────────────────────────────┬───────────────┘
        │  X-Internal-Key                   │
        │  ※ HTTP/1.1 only                  │
        ▼                                   │
┌────────────────────────────────┐          │
│  FastAPI 0.115        :8000    │          │
│  RAG · TSP · LLM · 규칙 판단   │          │
└───────┬───────────────┬────────┘          │
        │               │                   │
        ▼               ▼                   ▼
┌───────────────┐  ┌─────────────────────────────────┐
│ Claude        │  │  PostgreSQL 16                  │
│ Sonnet/Haiku  │  │  PostGIS(좌표) + pgvector(임베딩)│
│ OpenAI embed  │  └─────────────────────────────────┘
└───────────────┘  ┌─────────────────────────────────┐
                   │  Redis  캐시·세션·레이트리밋    │
                   └─────────────────────────────────┘
        ↑ Spring·FastAPI 둘 다 DB·Redis에 직접 붙는다
```

### 경계 — 어디에 뭐가 사는가

| | 책임 |
|---|---|
| **앱** | 화면 · **문구 조립(4개국어)** · 클라이언트 상태 |
| **Spring** | 인증 · 소유권 검증 · 과금 가드 · DB 영속화 · **FastAPI 프록시 및 SSE 중계** |
| **FastAPI** | RAG · TSP · LLM 호출 · **규칙 판단** |

> 🔑 **핵심 원칙 — "판단은 규칙이, 표현은 앱이"**
> 서버는 `{type, params}`(숫자·열거·시각)만 준다. 문장은 앱이 만든다.
> 이유 두 가지: ① 4개국어를 서버가 만들면 언어마다 프롬프트가 필요하다 ② 자유 문자열을 왕복시키면 **프롬프트 주입 통로**가 된다.

### 요청 1건이 지나는 길

```
요청
 │
 ├─▶ JwtAuthenticationFilter        토큰 없음      → 그냥 통과 (여기서 401 안 냄)
 │                                  만료·위조      → 즉시 JSON 쓰고 체인 중단
 │                                  정상          → SecurityContext에 userId 세팅
 │
 ├─▶ RateLimitFilter                Redis ZSet 슬라이딩 윈도우, 키 = userId
 │                                  /routes/generate  POST  3회/60s
 │                                  /chat             POST 10회/60s
 │                                  /routes/*/proactive GET 30회/60s
 │                                  초과 → 429 + Retry-After
 │                                  Redis 장애 → fail-open (로그만 남기고 통과)
 │
 ├─▶ AuthorizationFilter            미인증 401 / 권한부족 403
 │
 ├─▶ Controller → Service           BusinessException(ErrorCode.X) throw
 │
 └─▶ GlobalExceptionHandler         BusinessException → errorCode의 httpStatus
                                    @Valid 실패      → 422 + 필드 메시지
                                    그 외            → 500 (스택은 로그에만)
```

**필터 설계에서 짚을 것 3가지**

1. **`RateLimitFilter`는 일부러 `@Component`가 아니다.** `SecurityConfig:38`에서 직접 `new` 한다. `@Component`면 Spring Boot가 서블릿 필터로도 자동 등록해 **요청당 2번 실행** → 카운터가 2씩 올라 실제 허용량이 반토막 난다.
2. **`DispatcherType.ASYNC`를 permitAll 해뒀다** (`SecurityConfig:45`). SSE 완료 시 Tomcat이 재디스패치하는데 그때 SecurityContext가 비어 인증 재검사에 걸린다. **SSE 때문에 생긴 라인이다.**
3. **에러 JSON을 3곳에서 각자 만든다** — 필터 체인은 `@RestControllerAdvice`보다 앞이라 `GlobalExceptionHandler`가 못 잡는다. 형태(`ApiResponse.error`)만 통일돼 있다.

### 실행

```bash
make db-only                                   # PostgreSQL + Redis
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
cd ai      && uvicorn app.main:app --reload --port 8000
cd frontend && npx expo run:ios
```

---

## 3. 핵심 흐름 3개

세 흐름을 고른 이유는 각각 **다른 것을 가르쳐주기 때문**이다.

### 흐름 A — 루트 생성 SSE

> **왜 이걸 먼저**: 유일하게 세 서비스를 전부 지나간다. 그리고 **어느 문서에도 서술돼 있지 않다.**

```
  앱                 Spring                FastAPI              DB
  │                    │                      │                  │
  │ POST /routes/generate                     │                  │
  ├───────────────────▶│                      │                  │
  │                    │                                         │
  │         ┌──────────┴─────────────────────────────────┐       │
  │         │ 스트리밍 시작 전 — 여기서만 HTTP 에러 가능 │       │
  │         │  createRoute   Pass 검증 · 숙소 저장       │──────▶│
  │         │  createFixedSlots  확정 장소 pinned 선저장 │──────▶│
  │         └──────────┬─────────────────────────────────┘       │
  │                    │                                         │
  │ ◀── event "route_id"                                         │
  │   ▓▓▓ 이 순간 HTTP 200 확정 — 이후 503 불가능 ▓▓▓            │
  │                    │                      │                  │
  │                    │ POST /ai/routes/generate                 │
  │                    ├─────────────────────▶│                  │
  │                    │                      │                  │
  │                    │   ┌─ NDJSON 한 줄씩 반복 ─────────┐     │
  │ ◀── SSE send ──────┤◀──┤ 슬롯 / day_summary            │     │
  │                    │   │                                │     │
  │                    ├───┤ saveStreamingLine ─────────────┼────▶│
  │                    │   │ (저장 실패해도 스트림은 유지)  │     │
  │                    │   └────────────────────────────────┘     │
  │                    │                      │                  │
  │ ◀── {"done":true} ─┤                      │                  │
```

**추적**

| 단계 | 위치 |
|---|---|
| 화면 | `frontend/app/route/create/step-4.tsx` |
| SSE 수신 | `frontend/lib/api/routes.ts:233` `streamRoute()` |
| 진입 | `RouteController.java:216` |
| 과금 가드 | `RouteService.java:75` `passValidationService.validate()` |
| 고정 슬롯 선저장 | `RouteSlotService.java:163` |
| **첫 이벤트** | `RouteController.java:241` |
| FastAPI 호출 | `AiServiceClient.java:337` |
| 줄 단위 저장 | `RouteSlotService.java:58` `saveStreamingLine` |
| 폴백 | `FallbackRouteService` |

#### 함정 ① — `REQUIRES_NEW`가 붙은 진짜 이유

`RouteSlotService.java:53-57`에 주석이 그대로 있다.

```java
// REQUIRES_NEW를 여기 명시해야 함: saveStreamingSlot()을 this.로 self-invocation하면
// Spring AOP 프록시를 우회해 그 메서드 자신의 @Transactional이 무시되고, 클래스 레벨의
// readOnly=true 트랜잭션 안에서 실행되어 INSERT가 조용히 무효화된다(자기호출 프록시 우회 함정).
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void saveStreamingLine(UUID routeId, String jsonLine)
```

**조용히 무효화된다**는 게 핵심이다. 예외도 안 나고 로그도 안 남는데 데이터만 안 들어간다.

#### 함정 ② — 첫 이벤트를 보내는 순간 되돌릴 수 없다

`emitter.send("route_id")` 시점에 **HTTP 200이 커밋된다.** 이후로는 503을 줄 방법이 없다. 그래서 실패 처리가 3단이다.

```
FastAPI 실패 → DB 유사 루트 폴백 → 그것도 없으면 completeWithError
```

스트리밍을 쓰는 API를 설계할 때 늘 따라오는 제약이라, 이 코드는 그 교과서적인 예다.

#### 함정 ③ — `done`을 named event로 안 보낸다

클라이언트가 named event를 못 받는 문제가 있어서 일반 message로 보낸다(`RouteController.java:261` 주석). 앱은 보험으로 `done` 리스너와 `close` 리스너도 함께 단다(`routes.ts:285-291`).

---

### 흐름 B — 챗봇 → 루트 삽입

> **왜**: "서버가 어디까지 정하고 앱이 뭘 정하는가"의 경계가 가장 선명하다.

```
 유저 발화 "경복궁 가기 전에 카페"
     │
     ▼
 chat_service.py  ── 도구 3종 루프 (MAX_TOOL_ROUNDS = 3) ──┐
     │                search_nearby_places                 │
     │                get_weather_forecast                 │  최대 3왕복
     │                get_route_status                     │
     │◀────────────────────────────────────────────────────┘
     ▼
 _resolve_insertion   삽입 자리를 3단으로 내려가며 결정
     │   ① 대화 힌트에 장소명이 있나        → source = conversation
     │   ② Day만 특정되나                   → source = conversation_day
     │   ③ 시간 기반 위치 추정이 되나       → source = estimated
     │   ④ 다 실패                          → source = default (오늘 맨 뒤)
     ▼
  source == "conversation" ?
     │
     ├── 예 ──▶ 확인 없이 바로 삽입      "1일차 · 경복궁 다음에 추가돼요"
     │
     └── 아니오 ▶ InsertPlaceSheet 표시   유저가 자리를 직접 고름
                    │
                    ▼
            POST /v1/routes/{routeId}/slots
```

**삽입 자리를 한 함수에 가둔 이유** — `chat_service.py:674` 독스트링:

> ①대화 힌트 → ②위치 추정 → ③오늘 Day 맨 뒤 순으로 내려간다. 판단을 이 함수 하나에 가두는 이유는, **흩어지면 도구 설명(모델이 뭘 채울지)과 응답(앱이 뭘 받을지)이 서로 다른 자리를 말하게 되기 때문**이다.

`source`가 4종인 것도 이 때문이다. 신뢰도가 다르면 앱의 행동도 달라야 한다.

| `source` | 뜻 | 앱 동작 |
|---|---|---|
| `conversation` | 장소명 매칭 성공 = 자리 확정 | **바로 삽입** |
| `conversation_day` | Day만 특정 | 확인 시트 |
| `estimated` | 시간 기반 위치 추정 | 확인 시트 |
| `default` | 오늘 Day 맨 뒤 | 확인 시트 |

**짚을 것 2가지**

- **프로액티브 문맥을 완성 문장으로 안 보낸다** (`chat.ts:14-16`). `type`+`params`만 보내고 문장은 FastAPI가 스키마 검증 후 조립한다 — 완성 문장을 왕복시키면 시스템 프롬프트 주입 통로가 된다.
- **뒤 슬롯을 밀 때 한 건씩 flush한다** (`RouteSlotService.java:516`). Hibernate JDBC batch가 순서를 안 지켜 `uk_route_slots_day_order` 유니크 위반이 **실측됐다.**

---

### 흐름 C — 프로액티브 개입

> **왜**: 설계 원칙이 가장 선명하고, 지금 진행 중인 작업이 전부 여기 붙는다.

```
 화면 진입 (폴 방식 — 서버가 밀지 않는다)
     │
     ▼
 GET /v1/routes/{routeId}/proactive
     │
     ▼
 _build_snapshot        한 번에 다 긁어온다
     │  오늘 슬롯 · Day별 슬롯 · 날씨 · 예산 소진 · 북마크 반경
     │  숙소까지 거리 · 항공편 시각
     ▼
 _trip_phase(route, now)
     │
     ├── "pre_trip"  (D-1) ──▶ 규칙 2종 평가
     │                          FLIGHT_DEPARTURE · PRE_TRIP_BRIEFING
     │
     ├── "during"           ──▶ 규칙 7종 평가
     │                          RETURN_DEPARTURE · DEPARTURE_SOON · EMPTY_DAY
     │                          WEATHER_ALERT · BUDGET_OVER · BOOKMARK_NEARBY
     │                          FREE_GAP
     │
     └── "out_of_range"     ──▶ 아무것도 안 함
     │
     ▼
 _select(candidates)    min(priority) — 후보가 여럿이어도 하나만 내보낸다
     │
     ▼
 { "type": "DEPARTURE_SOON", "priority": 2, "params": { "minutes": 12, ... } }
     │                                   ▲
     │                    숫자·열거·시각만. 문장은 없다
     ▼
 앱  frontend/lib/proactiveText.ts
     └─▶ type + params + 현재 언어 → "12분 뒤 출발이에요" / "Leave in 12 min"
```

**규칙 9종**

| priority | type | 발동 |
|---:|---|---|
| 1 | `PRE_TRIP_BRIEFING` | D-1 — 진단 7종을 `flags` 배열로 한 번에 |
| 1 | `FLIGHT_DEPARTURE` / `RETURN_DEPARTURE` | 공항 출발 역산 (체크인 120분 + 도시별 이동시간) |
| 2 | `DEPARTURE_SOON` | 다음 슬롯 15분 전 |
| 3 | `EMPTY_DAY` | 빈 Day — **정오 이전에만**(저녁엔 이미 늦음) |
| 4 | `WEATHER_ALERT` | 강수·폭염(33°C)·한파(-5°C) |
| 5 | `BUDGET_OVER` | 예산 1.2배 초과 |
| 6 | `BOOKMARK_NEARBY` | 북마크 500m 이내 |
| 7 | `FREE_GAP` | 60분 이상 여유 |

임계값이 전부 파일 상단 상수로 빠져 있고 `# T2 — 조정 예정` 같은 주석이 달려 있다 — **튜닝 대상임을 코드가 스스로 밝힌다.**

#### 이 흐름의 진짜 교훈 — `_select`는 한계가 아니라 이음매다

`_select`가 `min(priority)`로 **하나만** 반환한다. 규칙이 늘면 낮은 우선순위는 안 뜬다. 그런데 독스트링을 보면:

```python
def _select(candidates: list[dict]) -> dict | None:
    """후보 중 하나를 고른다.

    지금은 priority 최솟값. 데이터가 늘어 후보가 동시에 여러 개 뜨기 시작하면
    이 함수만 LLM 호출로 교체한다 — 규칙층·API·프론트는 그대로 둔다.
    """
```

**미리 설계된 확장 지점이다.** 규칙층·API·프론트를 안 건드리고 이 함수만 갈아끼울 수 있게 경계를 그어놨다. 지금 규칙 6종을 더 붙이는 작업이 진행 중인데, 그때 선택지는 두 개다 — 이 함수를 LLM으로 바꾸거나, **안 급한 것들을 묶어 하루 1건으로 내보내거나(다이제스트).**

#### 지금 무엇이 붙는 중인가

V21(2026-08-01)로 `places`에 운영정보 **18컬럼**이 들어갔다 — 브레이크타임·마지막입장·외국카드·예약플랫폼·한글간판·휴관요일 등. 이 위에 규칙 6종(`CLOSED_DAY` `BREAK_TIME` `LAST_ENTRY` `RESERVATION_WALL` `LAST_TRANSIT` `PAYMENT_WALL`)이 올라간다. 컬럼별 의미는 `docs/03-data-model.md`.

> ⚠️ **`NULL` = 미조사, `0` = 조사했는데 없음.** 200곳만 채우므로 새 규칙 함수는 **`IS NOT NULL` 가드가 필수**다. 없으면 안 알아본 가게를 두고 "영어메뉴 없어요"라고 단정한다.

---

## 4. 세 흐름을 관통하는 원칙 2개

코드 곳곳 주석에 반복해서 나온다.

**① 외부 AI 실패는 사용자 액션을 롤백하지 않는다.**
슬롯 삽입·재정렬은 그대로 커밋하고, AI로 계산하던 **파생 데이터(이동시간·요금)만 `null`로 리셋**한다. *틀린 이동정보 < 정보 없음*.

**② 부분 재계산 대신 항상 Day 전체 재계산.**
`recomputeStartTimesForDay`가 09:00부터 다시 계산한다. Day당 슬롯 수가 적어 비용이 무시할 만하고, **삽입·삭제·교체가 뒤섞여도 정답을 보장**한다.

---

## 5. 읽는 순서

### 처음 30분

| | 파일 | 줄 | 왜 |
|---:|---|---:|---|
| 1 | `CLAUDE.md` (루트) | 27 | 레포 조감도로 가장 정확하고 짧다 |
| 2 | `common/response/ApiResponse.java` | 30 | 모든 응답의 껍데기 |
| 3 | `common/response/ErrorCode.java` | 68 | **실패 케이스 목록 = 도메인 지도** |
| 4 | `auth/config/SecurityConfig.java` | 83 | 필터 순서가 여기서 결정된다 |
| 5 | `frontend/lib/api/client.ts` | 51 | 프론트 통신의 단일 관문 |

### 그다음 — 난이도 순

| 난이도 | 대상 |
|---|---|
| 쉬움 | `common/*`(280줄 전체) · `PassValidationService`(33) · stores 6개(314) |
| 중간 | 예산 도메인 — **AI가 안 끼어드는 순수 CRUD**라 흐름 익히기 좋다 · `app/(tabs)/*` |
| 어려움 | `RouteSlotService`(570) · `AiServiceClient`(363) · `[routeId]/index.tsx`(1050) · `SlotCard.tsx`(604) |

### 요령 3가지

**`RouteSlotService.java`를 먼저 읽어라.** "왜 이렇게 했는가"를 **실측 근거까지** 적어둔 유일한 파일이다. 이 프로젝트의 설계 철학을 한 파일로 파악할 수 있다.

**테스트를 명세서로 읽어라.** `ai/tests/test_proactive_rules.py`(497줄)가 규칙 명세다. 문서보다 정확하다.

**"왜"가 궁금하면 `docs/superpowers/specs/`로.** 14개가 시간순으로 있고, 각 문서의 배경 절에 **당시 코드 현황**이 정확히 적혀 있다.

---

## 6. 손대기 전에 알아야 할 것

| 영역 | 주의 |
|---|---|
| `RouteSlotService` | `order_index`에 `(route_id, day_number, order_index)` UNIQUE + `>= 0` CHECK가 걸려 있다. 재정렬은 **2패스**(큰 오프셋으로 대피 → 최종 반영)로만 가능 |
| SSE | 첫 이벤트 이후엔 HTTP 상태를 못 바꾼다 |
| 트랜잭션 | 클래스 레벨 `readOnly=true`. 쓰기 메서드는 반드시 명시 |
| Flyway | V17이 V3와 중복이라 `IF NOT EXISTS`로 멱등화돼 있다. 기존 DB는 `./gradlew flywayRepair` 필요 |
| FastAPI 호출 | **HTTP/1.1만 지원.** HTTP/2로 붙이면 깨진다 |
| NativeWind | `TouchableOpacity`엔 `className` 대신 `style` (CssInterop 이슈) |
| 지도 마커 번호 | `orderIndex`가 아니라 **배열 위치(displayRank)** 기준 |

---

## 7. 다음에 볼 것

| 알고 싶은 것 | 어디로 |
|---|---|
| AI 루트 생성 내부 (RAG·TSP·프롬프트 캐싱) | `docs/05` |
| 챗봇 도구·모델 라우팅·비용 | `docs/06` |
| API 계약 52개 · 에러 코드 · 레이트리밋 | `docs/04` |
| DB 스키마 10테이블 | `docs/03` (원문은 `db/migration/` V1~V21) |
| 아키텍처 결정과 반영 상태 (ADR) | `docs/02` |
| 무엇이 안 됐나 | `planning/unimplemented.md` |
| 언제 뭘 했나 | `planning/milestones.md` |
| 왜 이 설계인가 | `docs/superpowers/specs/` (14개) |

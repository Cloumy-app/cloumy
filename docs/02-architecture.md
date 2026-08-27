# 시스템 아키텍처

> 기준일 **2026-08-06**. 이 문서는 **결정(ADR)과 그 결정이 코드에 반영된 상태**를 함께 적는다.
> "쓸 예정"과 "쓰고 있다"를 섞어 적었던 이전 버전을 실제 코드 기준으로 정정했다.

---

## 전체 구조 — 지금 돌아가는 것

```
┌───────────────────────────────────────────────────────────┐
│  앱  Expo SDK 56 / React Native                           │
│      expo-router · Zustand · TanStack Query · NativeWind  │
│      지도 react-native-maps (Google Maps SDK)             │
└──────────────────────────┬────────────────────────────────┘
                           │  HTTPS · Authorization: Bearer
                           ▼
┌───────────────────────────────────────────────────────────┐
│  Spring Boot 3.3.5 / Java 21              :8080           │
│  ─ 단일 모놀리식. 별도 게이트웨이 없음 ─                   │
│  JWT 인증 · 레이트리밋 · 소유권 검증 · 과금 가드           │
│  DB 영속화 · FastAPI 프록시 및 SSE 중계                    │
└───────┬───────────────────────────────────┬───────────────┘
        │  X-Internal-Key                   │
        │  ※ HTTP/1.1 only                  │
        ▼                                   │
┌────────────────────────────────┐          │
│  FastAPI 0.115 / Python 3.11   │          │
│                        :8000   │          │
│  RAG(pgvector) · TSP(OR-Tools) │          │
│  LLM 호출 · 프로액티브 규칙 판단│          │
└───────┬───────────────┬────────┘          │
        │               │                   │
        ▼               ▼                   ▼
┌───────────────┐  ┌─────────────────────────────────┐
│ Claude        │  │  PostgreSQL 16                  │
│ Sonnet/Haiku  │  │  PostGIS(좌표) + pgvector(임베딩)│
│ OpenAI embed  │  └─────────────────────────────────┘
└───────────────┘  ┌─────────────────────────────────┐
                   │  Redis  캐시·챗봇 세션·레이트리밋│
                   └─────────────────────────────────┘
        ↑ Spring·FastAPI 둘 다 DB·Redis에 직접 붙는다
```

### 이전 문서에 있었지만 실제로는 없는 것

| 적혀 있던 것 | 실제 |
|---|---|
| **Spring Cloud Gateway** | 없다. 인증·레이트리밋은 Spring Boot **서블릿 필터 체인**에서 한다 |
| **socket.io / WebSocket** | 없다. 스트리밍은 **SSE 하나**(루트 생성)뿐이고 챗봇은 일반 POST다 |
| **Elasticsearch** | 없다. 검색은 PostGIS + GIN 인덱스로 처리 |
| **Kafka / Spring @Async 임베딩 큐** | 없다. 임베딩은 별도 스크립트 배치 |
| **AWS S3** | 코드 흔적 0. 업로드 기능 자체가 없다 |
| **FCM 푸시** | 코드 흔적 0. 프로액티브는 푸시가 아니라 **앱 진입 시 배너(폴 방식)** |
| **`@Scheduled` 배치** | **0개.** 주기 작업이 하나도 없다 |
| Auth/Trip/Community/Budget **서비스 분리** | 분리 안 됨. 같은 이름의 **패키지**로만 나뉜 모놀리식 |

### 경계 — 어디에 뭐가 사는가

| | 책임 |
|---|---|
| **앱** | 화면 · **문구 조립(4개국어)** · 클라이언트 상태 |
| **Spring** | 인증 · 소유권 검증 · 과금 가드 · DB 영속화 · FastAPI 프록시 및 SSE 중계 |
| **FastAPI** | RAG · TSP · LLM 호출 · **규칙 판단** |

> 🔑 **핵심 원칙 — "판단은 규칙이, 표현은 앱이"**
> 서버는 `{type, params}`(숫자·열거·시각)만 준다. 문장은 앱이 만든다.
> 이유 두 가지: ① 4개국어를 서버가 만들면 언어마다 프롬프트가 필요하다 ② 자유 문자열을 왕복시키면 **프롬프트 주입 통로**가 된다.

---

## 주요 기술 결정 (ADR)

각 ADR에 **실제 반영 상태**를 붙였다.

### ADR-1: 모바일 — React Native + Expo

- **결정**: Flutter 대신 React Native + Expo
- **이유**: TypeScript 생태계, OTA 업데이트로 심사 없이 핫픽스, react-native-maps의 Google Maps SDK 연동이 안정적
- **트레이드오프**: 네이티브 성능은 Flutter보다 낮으나 MVP 속도 우선
- **반영**: ✅ Expo SDK 56 + expo-router. 상태는 Zustand, 서버 상태는 TanStack Query, 스타일은 NativeWind

### ADR-2: 백엔드 — Spring Boot

- **결정**: Node.js 대신 Spring Boot 3.x
- **이유**: 복잡한 여행 데이터 쿼리(JPA + QueryDSL), 한국 개발자 풀, PostGIS 연동
- **반영**: ⚠️ **QueryDSL은 의존성·애노테이션 프로세서만 걸려 있고 코드에서 한 번도 안 쓴다**(`com.querydsl` import 0건). 복잡한 쿼리는 **네이티브 SQL `@Query` 13개**로 처리 중이다 — PostGIS 함수(`ST_DWithin` 등)는 어차피 JPQL로 표현이 안 되기 때문이다.
  → 쓰지 않을 거면 빌드에서 빼는 게 맞다. 결정 자체를 되돌릴지는 별도 판단이 필요하다.

### ADR-3: AI 서비스 — Python FastAPI 분리

- **결정**: Spring 내부가 아닌 별도 서비스
- **이유**: AI 스택(LangChain, OR-Tools, pgvector)이 Python 생태계에 있고, Spring과 독립적으로 고도화할 수 있다
- **트레이드오프**: 서비스 간 HTTP 오버헤드
- **반영**: ✅ 다만 **완전한 마이크로서비스는 아니다** — 두 서비스가 **같은 PostgreSQL을 직접 공유한다.** DB가 사실상의 결합점이라, 스키마를 바꾸면 양쪽을 같이 봐야 한다.
- ⚠️ **호출은 HTTP/1.1로 고정이다.** HTTP/2로 붙이면 깨진다. gRPC 전환은 검토만 된 상태.

### ADR-4: 지도 — Google Maps 렌더링 + 내비 딥링크 분기

- **결정**: 앱 내 렌더링은 Google Maps SDK로 통일. 내비는 이동수단별 분기 — 대중교통 → Naver, 도보 → Google, 택시 → 카카오T
- **이유**: 외국인에게 Google Maps의 영어 UI가 가장 친숙하지만, 한국 대중교통 정확도는 Naver가 압도적이다(영어 모드 지원). 택시는 카카오T가 해외 카드 결제를 지원한다
- **반영**: ⚠️ **walk / transit 2-way만 구현.** 택시 딥링크는 **보류** — 현지에서 우버가 실제로 쓸 만한지 확인한 뒤 판단하기로 했다
- **트레이드오프**: Google Maps 2025 신요금, MAU 1만 기준 월 $100~200 예상

### ADR-5: 임베딩 — OpenAI text-embedding-3-small

- **결정**: LLM은 Anthropic Claude, 임베딩은 OpenAI
- **이유**: Anthropic 임베딩 API 미출시. 비용 효율
- **트레이드오프**: API 키 이중 관리
- **반영**: ✅ 1536차원, `places.embedding`. ivfflat 인덱스 `lists=100`

### ADR-6: 결제 — ⚠️ 재검토 필요 (PG 미확정)

- **기존 결정**: IAP 대신 토스페이먼츠 웹뷰로 30% 수수료 우회
- **재검토 사유**: 토스페이먼츠는 **국내 전용 PG**라 외국인의 해외 발급 카드를 지원하지 않는다 — 타겟 전환 후 그대로 쓸 수 없다
- **후보**: Stripe 등 국제결제 PG (웹뷰 방식을 유지하면 수수료 우회 이점도 유지된다)
- **반영**: ❌ 미구현. `PassValidationService` 33줄이 전부고 `payments` 테이블도 없다. **PG를 고르는 게 선행 과제다**

---

## 서비스 간 통신 — 실제

| 구간 | 프로토콜 | 인증 |
|---|---|---|
| 앱 ↔ Spring | HTTPS REST | `Authorization: Bearer {JWT}` |
| 앱 ↔ Spring (루트 생성) | **SSE** (`text/event-stream`) | 동일 |
| Spring → FastAPI | **HTTP/1.1** (내부 6개 엔드포인트) | `X-Internal-Key` 헤더 |
| Spring·FastAPI → PostgreSQL / Redis | 직접 연결 | — |

**앱은 FastAPI에 직접 붙지 않는다.** 전부 Spring을 거친다.

### 요청 1건이 지나는 필터 체인

```
JwtAuthenticationFilter → RateLimitFilter → AuthorizationFilter → Controller
                                                                → GlobalExceptionHandler
```

**설계에서 짚을 것 3가지**

1. **`RateLimitFilter`는 일부러 `@Component`가 아니다.** `SecurityConfig:38`에서 직접 `new` 한다. `@Component`면 Spring Boot가 서블릿 필터로도 자동 등록해 **요청당 2번 실행**되어 실제 허용량이 반토막 난다.
2. **`DispatcherType.ASYNC`를 permitAll 해뒀다**(`SecurityConfig:45`). SSE 완료 시 Tomcat이 재디스패치하는데 그때 SecurityContext가 비어 인증 재검사에 걸린다 — **SSE 때문에 생긴 라인이다.**
3. **에러 JSON을 3곳에서 각자 만든다.** 필터 체인은 `@RestControllerAdvice`보다 앞이라 `GlobalExceptionHandler`가 못 잡는다. 형태(`ApiResponse.error`)만 통일돼 있다.

상세는 `docs/04-api-spec.md`.

---

## 프로젝트 구조 — 모노레포

계획은 `cloumy-app` / `cloumy-backend` / `cloumy-ai` **3개 저장소 분리**였으나, 실제로는 **단일 모노레포**로 갔다. 세 서비스를 한 커밋에서 같이 고쳐야 하는 변경이 잦아 분리 비용이 이득보다 컸다.

```
cloumy/
├── frontend/                    # React Native (Expo)
│   ├── app/                    # expo-router 파일 기반 라우팅
│   ├── components/             # 화면 단위 컴포넌트
│   ├── lib/                    # api 클라이언트 · i18n(ko/en/ja/zh) · 유틸
│   ├── stores/                 # Zustand
│   └── types/index.ts          # 앱 타입의 단일 출처
│
├── backend/                     # Spring Boot 3.3.5 / Java 21
│   └── src/main/
│       ├── java/com/cloumy/
│       │   ├── auth/           # OAuth · JWT · SecurityConfig
│       │   ├── trip/           # 루트 · 슬롯 · 숙소 · 챗봇 프록시
│       │   ├── budget/         # 예산 · 지출
│       │   ├── place/          # 장소 · 탐색 · 북마크
│       │   └── common/         # ApiResponse · ErrorCode · 필터
│       └── resources/db/migration/   # ⭐ Flyway V1~V21 — DB의 진실
│
├── ai/                          # FastAPI / Python 3.11
│   ├── app/routes/             # 내부 엔드포인트 6개
│   ├── app/services/           # route_gen · chat · proactive · tsp · retrievers
│   └── tests/                  # 12파일 2,712줄 — 사실상 최신 명세
│
├── db/init.sql                  # postgis · vector 확장 설치 (Flyway 밖)
├── docker-compose.yml
├── .github/workflows/           # ci.yml · deploy.yml
├── docs/                        # 지금 읽는 문서들
└── planning/                    # milestones · unimplemented · strategy
```

> `CLAUDE.md`가 루트 포함 4곳에 있다(총 131줄). 각 서비스의 컨벤션과 함정을 짧게 적어둔 것이라 **레포에서 가장 정확한 조감도**다.

---

## 환경 설정

### 환경 변수

```bash
# LLM / 임베딩
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...            # 임베딩 전용

# 지도 · 장소
GOOGLE_MAPS_API_KEY=...
KAKAO_REST_API_KEY=...           # 로컬 검색(숙소·장소)에 실제 사용 중
TOUR_API_KEY=...                 # 큐레이션 데이터 수집
OPENWEATHER_API_KEY=...

# 서비스 간
INTERNAL_API_KEY=...             # Spring → FastAPI

# DB
POSTGRES_URL=...
REDIS_URL=redis://localhost:6379
```

**미발급 상태라 코드도 없는 것들** — `KOPIS_API_KEY`(공연 정보) · 네이버 블로그 검색(`trend_score`가 비어 있는 원인) · `AWS_S3_*` · `FCM_SERVER_KEY` · 결제 PG 키. `planning/milestones.md` Phase 0 참고.

> ⚠️ **`.env`는 절대 커밋하지 않는다.**

### 로컬 개발

```bash
make db-only                                   # PostgreSQL + Redis만
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
cd ai      && uvicorn app.main:app --reload --port 8000
cd frontend && npx expo run:ios
```

- **호스트 포트가 5433이다** (`docker-compose.yml`의 `"5433:5432"`). 컨테이너 안에서는 5432. 다른 프로젝트와 충돌해 임시로 옮긴 것이라 **되돌릴 예정**이다(`planning/unimplemented.md` 🟡).
- **postgres는 공식 이미지가 아니라 `db/Dockerfile`로 빌드한다** — `postgis/postgis:16-3.4`에 pgvector를 얹은 것이라 둘 다 필요해서다. 확장 설치(`CREATE EXTENSION`)는 Flyway가 아니라 `db/init.sql`이 한다 — 마이그레이션보다 먼저 있어야 하기 때문.
- `docker-compose.yml`의 서비스는 **spring · fastapi · postgres · redis 4개뿐**이다.
- Expo에서 `EXPO_PUBLIC_*`는 **번들 시점에 값이 박힌다** — `.env`를 고치면 Metro를 재시작해야 한다.

---

## CI/CD — 실제 워크플로

| 워크플로 | 하는 일 |
|---|---|
| `ci.yml` | Spring: `checkstyleMain checkstyleTest` → `test` / FastAPI: `flake8 --max-line-length=120` → `pytest` |
| `deploy.yml` | backend·ai 이미지 빌드 → **GHCR 푸시** → **EC2에 SSH 배포** |

> 🔑 **로컬에서 `./gradlew compileJava`만 돌리면 CI에서 깨진다.** Checkstyle이 CI에만 있어서다 — `./gradlew checkstyleMain checkstyleTest test`를 그대로 돌려야 한다. (`LeftCurly` 위반으로 실제로 CI가 깨진 적이 있다.)

### 배포 진화 계획

| 단계 | 인프라 |
|---|---|
| **현재** | AWS EC2 단일 서버 + Docker Compose (GHCR 이미지) |
| 다음 | EC2 + RDS (PostgreSQL 관리형)로 DB 분리 |
| Phase 2 | ECS Fargate + Auto Scaling |

---

## 다음에 볼 것

| 알고 싶은 것 | 어디로 |
|---|---|
| 코드가 실제로 어떻게 도는가 (흐름 3개) | `docs/08-codebase-guide.md` |
| API 계약 52개 | `docs/04-api-spec.md` |
| DB 스키마 | `docs/03-data-model.md` |
| AI 파이프라인 내부 | `docs/05-ai-service-architecture.md` |
| 챗봇 | `docs/06-ai-chatbot.md` |

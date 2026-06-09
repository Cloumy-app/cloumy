# 시스템 아키텍처

## 전체 구조 다이어그램

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[클라이언트]
  React Native + Expo (iOS / Android)
  - 지도: react-native-maps (Google Maps SDK)
  - 내비: 카카오맵 딥링크 → Phase 2: 인앱 내비
  - 실시간: socket.io-client (챗봇 스트리밍, 그룹 동기화)
  - 결제: 토스페이먼츠 웹뷰 (react-native-webview)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[API Gateway — Spring Cloud Gateway]
  - JWT 인증 필터
  - 서비스별 요청 라우팅
  - Rate Limiting (LLM 과호출 방지)
  - HTTPS 종단
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[백엔드 — Spring Boot 3.x]
  MVP 초반(0~3개월): 모놀리식
  MVP 후반(3~6개월): Auth / Trip / Community 서비스 분리 시작

  ┌──────────┬──────────┬──────────┬──────────┐
  │ Auth     │ Trip     │Community │ Budget   │
  │ - 소셜   │ - 루트   │ - Hidden │ - 예산   │
  │   로그인  │   CRUD   │   Gems   │   설정   │
  │ - JWT    │ - 일정   │ - 태그   │ - 지출   │
  │   발급   │   관리   │   피드   │   추적   │
  └──────────┴──────────┴──────────┴──────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[AI 서비스 — Python FastAPI + LangChain]
  처음부터 Spring과 분리된 마이크로서비스
  - 모델 라우팅 (Haiku ↔ Sonnet)
  - RAG 파이프라인 (pgvector 검색)
  - OR-Tools TSP 동선 최적화
  - Function Calling (챗봇 도구 호출)
  - 예산 자연어 파싱
  - 희소성 점수 계산
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[데이터 레이어]
  PostgreSQL + PostGIS   pgvector        Redis
  - 장소 DB              - 장소 임베딩    - 챗봇 세션
  - 루트·일정            - 유사 장소 검색 - 장소 캐시 (TTL 24h)
  - 사용자·결제          - RAG 검색       - JWT 블랙리스트

  AWS S3
  - Hidden Gems 사진, 방문 인증 이미지, 여행 일지

  ── Phase 1 후반 ~ 단계적 전환 ──
  Elasticsearch (MAU 증가 후)
  - 장소 전문 검색 (Nori 한국어 형태소)

  Kafka (Phase 2~, 데이터 규모 커진 후)
  - 임베딩 생성 큐, 비동기 파이프라인
  MVP 초반은 Spring @Async로 대체
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[외부 API]
  Google Maps Platform    카카오 로컬 API    TourAPI (무료)
  Claude API (Anthropic)  카카오맵 딥링크    토스페이먼츠
  카카오 OAuth            구글 OAuth         애플 Sign In
  FCM                     기상청 API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[인프라]
  AWS EC2 (MVP 초반) → ECS Fargate + Auto Scaling (Phase 2)
  Docker + GitHub Actions CI/CD
```

## MVP 아키텍처 진화 전략

| 단계 | 아키텍처 | 이유 |
|------|----------|------|
| MVP 초반 (0~3개월) | Spring Boot 모놀리식 + FastAPI AI 분리 | AI 서비스만 분리, 나머지는 빠르게 개발 |
| MVP 후반 (3~6개월) | Spring Auth/Trip/Community 서비스 분리 시작 | MAU·트래픽 패턴 파악 후 병목만 분리 |
| Phase 2 (6개월~) | 완전한 마이크로서비스 + ECS Fargate + Kafka | 검증된 구조 기반 확장 |

## 주요 기술 결정 (ADR)

### ADR-1: 모바일 — React Native + Expo
- **결정**: Flutter 대신 React Native + Expo 선택
- **이유**: TypeScript 생태계 활용, OTA 업데이트로 앱스토어 심사 없이 핫픽스, react-native-maps Google Maps SDK 안정적
- **트레이드오프**: 네이티브 성능은 Flutter 대비 다소 낮으나 MVP 속도 우선

### ADR-2: 백엔드 — Spring Boot
- **결정**: Node.js 대신 Spring Boot 3.x 선택
- **이유**: 복잡한 여행 데이터 쿼리(JPA + QueryDSL), 한국 개발자 풀 풍부, PostGIS 연동 안정적
- **트레이드오프**: 초기 보일러플레이트 많으나 확장성 확보

### ADR-3: AI 서비스 — Python FastAPI 분리
- **결정**: Spring 내부가 아닌 FastAPI 별도 서비스로 분리
- **이유**: AI 파이프라인(LangChain, OR-Tools, pgvector)이 Python 생태계에 최적화. Spring과 독립적으로 AI 스택 고도화 가능
- **트레이드오프**: 서비스 간 HTTP 통신 오버헤드 발생 (내부 gRPC 전환 고려)

### ADR-4: 지도 — Google Maps 단일 인프라
- **결정**: 카카오맵 전체 대신 Google Maps 렌더링 + 카카오맵 딥링크(내비만)
- **이유**: 해외 확장 시 카카오맵 전체 교체 비용 방지. 국내 장소 DB는 TourAPI + 카카오 로컬 API로 보강
- **트레이드오프**: Google Maps 2025년 신요금 적용. MAU 1만 기준 월 $100~200 예상

### ADR-5: 임베딩 — OpenAI text-embedding-3-small
- **결정**: LLM은 Anthropic Claude, 임베딩은 OpenAI API 분리 사용
- **이유**: Anthropic 임베딩 API 미출시. text-embedding-3-small 비용 효율 최적
- **트레이드오프**: API 키 이중 관리 필요 (ANTHROPIC_API_KEY, OPENAI_API_KEY)
- **추후**: Anthropic 임베딩 API 출시 시 단일화 검토

### ADR-6: 결제 — 토스페이먼츠 웹뷰
- **결정**: 인앱결제(IAP) 대신 토스페이먼츠 웹뷰 결제
- **이유**: 구글/애플 인앱결제 강제 시 30% 수수료 발생. 웹뷰 방식으로 우회
- **트레이드오프**: 앱 내 결제 유도 UI 노출 금지 정책 주의 필요

## 서비스 간 통신

| 통신 유형 | 구간 | 프로토콜 |
|-----------|------|----------|
| 일반 API 요청 | 클라이언트 ↔ API Gateway | HTTPS REST |
| 챗봇 스트리밍 | 클라이언트 ↔ AI Service | WebSocket |
| 그룹 여행 동기화 | 클라이언트 ↔ Trip 서비스 | WebSocket + Redis Pub/Sub |
| 루트 생성·챗봇 요청 | Spring ↔ AI Service | HTTP (내부 gRPC 고려) |
| 비동기 임베딩 생성 | MVP: Spring @Async / Phase 2: Kafka | - |

## 프로젝트 폴더 구조

```
cloumy/
├── cloumy-app/                  # React Native (Expo)
│   ├── src/
│   │   ├── app/                # Expo Router 기반 라우팅
│   │   ├── components/         # 공통 컴포넌트
│   │   ├── features/           # 기능별 모듈 (route, chat, budget, community)
│   │   ├── stores/             # Zustand 상태 관리
│   │   ├── hooks/              # 커스텀 훅
│   │   ├── services/           # API 클라이언트 (TanStack Query)
│   │   └── types/              # TypeScript 타입 정의
│   └── package.json
│
├── cloumy-backend/              # Spring Boot
│   ├── src/main/java/com/cloumy/
│   │   ├── auth/               # 인증 모듈
│   │   ├── trip/               # 루트·일정 모듈
│   │   ├── community/          # Hidden Gems, 태그 모듈
│   │   ├── budget/             # 예산·지출 모듈
│   │   ├── payment/            # 결제 모듈
│   │   └── common/             # 공통 유틸, 예외 처리
│   └── build.gradle
│
├── cloumy-ai/                   # Python FastAPI
│   ├── app/
│   │   ├── routes/             # 엔드포인트 (route_gen, chatbot, embedding)
│   │   ├── services/           # 비즈니스 로직 (rag, tsp, scoring)
│   │   ├── models/             # Pydantic 모델
│   │   └── config/             # 환경 설정, API 키
│   └── requirements.txt
│
├── docker-compose.yml          # 로컬 개발 환경
├── .github/workflows/          # GitHub Actions CI/CD
└── docs/                       # 지금 읽는 문서들
```

## 환경 설정

### 환경 변수 (주요)

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (임베딩 전용)
OPENAI_API_KEY=sk-...

# Google Maps
GOOGLE_MAPS_API_KEY=...

# 카카오
KAKAO_REST_API_KEY=...
KAKAO_OAUTH_CLIENT_ID=...

# DB
POSTGRES_URL=jdbc:postgresql://localhost:5432/cloumy
REDIS_URL=redis://localhost:6379

# AWS
AWS_S3_BUCKET=cloumy-uploads
AWS_REGION=ap-northeast-2

# 결제
TOSS_PAYMENTS_SECRET_KEY=...

# FCM
FCM_SERVER_KEY=...
```

### 로컬 개발 환경
- Docker Compose로 PostgreSQL + PostGIS + pgvector, Redis, Elasticsearch 실행
- Spring Boot: `./gradlew bootRun`
- FastAPI: `uvicorn app.main:app --reload`
- React Native: `npx expo start`

## 배포 전략

| 단계 | 인프라 | 비고 |
|------|--------|------|
| MVP 초반 | AWS EC2 단일 서버 | t3.medium, 비용 절감 |
| MVP 후반 | EC2 + RDS (PostgreSQL 관리형) | DB 분리 |
| Phase 2 | ECS Fargate + Auto Scaling | 트래픽 증가 대응 |
| CI/CD | GitHub Actions | 처음부터 적용 |

<div align="center">

# Cloumy

**목적지와 날짜만 넣으면 AI가 나만의 루트를 짜주는 여행 원스톱 앱**

![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.x-6DB33F?style=flat-square&logo=springboot&logoColor=white)
![Java](https://img.shields.io/badge/Java-21-ED8B00?style=flat-square&logo=openjdk&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat-square&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-Expo-0088CC?style=flat-square&logo=expo&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL+pgvector-316192?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## 소개

여행 계획에 평균 4.2개 앱을 전전하는 문제를 해결합니다.
내 날짜·예산·스타일을 입력하면 AI가 최적 동선을 짜고, 여행 중에도 챗봇이 실시간으로 함께합니다.

| 페르소나 | 기존 | Cloumy |
|----------|------|--------|
| 계획 울렁증 직장인 | 4.2개 앱 전전, 수시간 소요 | 3분 입력 → AI가 완성된 일정 |
| 먹방 원정대 | 맛집 리스트 따로, 동선 따로 | 먹방 태그 기반 최적 루트 자동 생성 |
| 콘서트 원정 | 공연 시간 맞춰 수동 조합 | 공연 시간 입력 → AI가 전체 동선 배치 |

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 🤖 AI 루트 자동 생성 | 목적지·날짜·스타일 입력 → LLM + RAG + TSP 동선 최적화 |
| 📌 Pin & Reshuffle | 마음에 드는 일정은 고정, 싫은 슬롯만 AI 재추천 |
| 💬 AI 챗봇 | 여행 전 대화형 플래닝 + 여행 중 실시간 대응 |
| 💰 예산 관리 | 계획/비계획 지출 분리 추적, 예산 초과 시 챗봇 대안 제시 |
| 🔮 Hidden Gems | GPS 인증(반경 100m) 기반 현지인 숨은 명소 등록·공유 |
| 👥 그룹 여행 | 실시간 동기화, 일정 투표, 개인 지출 추적 |

---

## 스크린샷

> Coming Soon — MVP 출시 후 업데이트 예정

---

## 아키텍처

### 레이어 구성

<table>
  <tr>
    <td align="center" width="33%">
      <b>📱 클라이언트</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=react,ts,expo&theme=light" height="40"/><br/>
      <sub>React Native · Expo · TypeScript</sub>
    </td>
    <td align="center" width="33%">
      <b>🔀 API Gateway</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=nginx&theme=light" height="40"/><br/>
      <sub>Nginx · 리버스 프록시 · HTTPS</sub>
    </td>
    <td align="center" width="33%">
      <b>🚀 인프라 / CI·CD</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=docker,githubactions,aws&theme=light" height="40"/><br/>
      <sub>Docker · GitHub Actions · AWS</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>⚙️ 백엔드</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=spring,java&theme=light" height="40"/><br/>
      <sub>Spring Boot 3.x · Java 21</sub>
    </td>
    <td align="center">
      <b>🤖 AI 서비스</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=python,fastapi&theme=light" height="40"/><br/>
      <sub>FastAPI · LangChain · OR-Tools · Claude</sub>
    </td>
    <td align="center">
      <b>🗄️ 데이터</b><br/><br/>
      <img src="https://skillicons.dev/icons?i=postgres,redis,aws&theme=light" height="40"/><br/>
      <sub>PostgreSQL + pgvector + PostGIS · Redis · S3</sub>
    </td>
  </tr>
</table>

<br/>

### 전체 흐름

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '13px', 'primaryColor': '#f8f9fa', 'primaryBorderColor': '#dee2e6'}}}%%
graph TB
    subgraph CLIENT["📱  클라이언트  —  React Native + Expo"]
        RN["iOS / Android\nreact-native-maps · Socket.IO · Toss WebView"]
    end

    subgraph GATEWAY["🔀  Nginx  —  API Gateway"]
        NG["리버스 프록시 · HTTPS 종단 · 라우팅"]
    end

    subgraph BACKEND["⚙️  Spring Boot 3.x  —  Java 21"]
        direction LR
        AUTH["🔐 Auth\nJWT · 소셜 로그인"]
        TRIP["🗺️ Trip\n루트 · 일정 CRUD"]
        COMMUNITY["🔮 Community\nHidden Gems · 피드"]
        BUDGET["💰 Budget\n예산 · 지출 추적"]
        PAYMENT["💳 Payment\n트립 패스 · 결제"]
    end

    subgraph AISERVICE["🤖  FastAPI  —  Python 3.11"]
        direction LR
        RAG["📚 RAG\npgvector 유사도 검색"]
        TSP["🗾 OR-Tools TSP\n동선 최적화"]
        CHAT["💬 LangChain\n멀티턴 · Function Calling"]
        EMBED["🔢 Embedding\ntext-embedding-3-small"]
    end

    subgraph DATA["🗄️  데이터 레이어"]
        direction LR
        PG[("🐘 PostgreSQL\n+ PostGIS + pgvector")]
        REDIS[("⚡ Redis\n세션 · 캐시 · 블랙리스트")]
        S3["☁️ AWS S3\n사진 · 이미지"]
    end

    subgraph EXTERNAL["🌐  외부 API"]
        direction LR
        CLAUDE["🤖 Claude API\nSonnet 4.6 · Haiku 4.5"]
        KAKAO["🟡 카카오\nOAuth · 로컬 API"]
        TOUR["📍 TourAPI / KOPIS\n장소 · 공연 데이터"]
        TOSS["💳 토스페이먼츠\n결제"]
        GMAP["🗺️ Google Maps\n지도 렌더링"]
    end

    RN -->|"HTTPS REST / WebSocket"| NG
    NG -->|REST| BACKEND
    NG -->|WebSocket| AISERVICE

    BACKEND -->|"HTTP (X-Internal-Key)"| AISERVICE
    BACKEND --- PG
    BACKEND --- REDIS
    BACKEND --- S3

    AISERVICE --- PG
    AISERVICE --- REDIS
    AISERVICE -->|LLM 호출| CLAUDE
    AISERVICE --- EMBED

    BACKEND -->|OAuth| KAKAO
    BACKEND -->|데이터 수집| TOUR
    BACKEND -->|결제 검증| TOSS
    RN -->|지도 렌더링| GMAP

    classDef clientStyle fill:#EBF5FB,stroke:#2E86C1,color:#1A5276,rx:8
    classDef gatewayStyle fill:#F2F3F4,stroke:#717D7E,color:#2C3E50,rx:8
    classDef backendStyle fill:#EAFAF1,stroke:#1E8449,color:#145A32,rx:8
    classDef aiStyle fill:#FEF9E7,stroke:#D4AC0D,color:#7D6608,rx:8
    classDef dataStyle fill:#F5EEF8,stroke:#7D3C98,color:#4A235A,rx:8
    classDef externalStyle fill:#FDEDEC,stroke:#C0392B,color:#7B241C,rx:8

    class RN clientStyle
    class NG gatewayStyle
    class AUTH,TRIP,COMMUNITY,BUDGET,PAYMENT backendStyle
    class RAG,TSP,CHAT,EMBED aiStyle
    class PG,REDIS,S3 dataStyle
    class CLAUDE,KAKAO,TOUR,TOSS,GMAP externalStyle
```

### 서비스 간 통신

| 구간 | 프로토콜 | 비고 |
|------|----------|------|
| 클라이언트 ↔ Spring | HTTPS REST | 일반 API 요청 |
| 클라이언트 ↔ FastAPI | WebSocket | 챗봇 스트리밍, 루트 생성 스트리밍 |
| Spring ↔ FastAPI | HTTP (내부) | `X-Internal-Key` 헤더 인증 |
| 그룹 여행 동기화 | WebSocket + Redis Pub/Sub | 실시간 일정 공유 |

### MVP → MSA 전환 전략

| 단계 | 구조 | 시점 |
|------|------|------|
| MVP 초반 | Spring 모놀리식 + FastAPI 분리 | 0~3개월 |
| MVP 후반 | Auth · Trip · Community 서비스 분리 | 3~6개월 |
| Phase 2 | 완전한 MSA + ECS Fargate + Kafka | MAU 기반 병목 확인 후 |

---

## 기술 스택

| 영역 | 기술 | 결정 이유 |
|------|------|----------|
| 모바일 | React Native + Expo | TypeScript 생태계, OTA 핫픽스, iOS·Android 동시 개발 |
| 백엔드 | Spring Boot 3.x / Java 21 | 복잡한 여행 데이터 쿼리, PostGIS 연동 안정적 |
| AI 서비스 | Python FastAPI + LangChain | AI 파이프라인이 Python 생태계에 최적화 |
| LLM | Claude Sonnet 4.6 / Haiku 4.5 | 기능별 모델 라우팅 (비용 최적화) |
| 임베딩 | OpenAI text-embedding-3-small | Anthropic 임베딩 미출시, 비용 효율 최적 |
| DB | PostgreSQL + PostGIS + pgvector | 지리 데이터 + 벡터 검색 단일 DB로 처리 |
| 캐시 | Redis | 챗봇 세션, 장소 캐시(TTL 24h), JWT 블랙리스트 |
| 인증 | JWT + OAuth 2.0 | 카카오·구글·애플 소셜 로그인 |
| 결제 | 토스페이먼츠 웹뷰 | 인앱결제 30% 수수료 우회 |
| 인프라 | AWS EC2 → ECS Fargate | MVP EC2 단일 → 트래픽 증가 후 Fargate 전환 |

---

## 프로젝트 구조

```
cloumy/
├── frontend/                  # React Native (Expo)
├── backend/                   # Spring Boot
│   └── src/main/java/com/cloumy/
│       ├── auth/              # JWT · 소셜 로그인
│       ├── trip/              # 루트 · 일정
│       ├── community/         # Hidden Gems · 피드
│       ├── budget/            # 예산 · 지출
│       ├── payment/           # 트립 패스 · 결제
│       └── common/            # 공통 예외 · 응답 포맷
├── ai/                        # Python FastAPI
│   └── app/
│       ├── routes/            # 엔드포인트
│       ├── services/          # RAG · TSP · 챗봇
│       ├── models/            # Pydantic 모델
│       └── config/            # 환경 설정
├── db/                        # PostgreSQL 초기화 스크립트
├── nginx/                     # Reverse Proxy 설정
├── docs/                      # 기획서 · API 명세 · 데이터 모델
├── planning/                  # 마일스톤 · 우선순위
├── docker-compose.yml
└── .env.example
```

---

## 로컬 개발 환경

### 사전 요구사항

- Docker & Docker Compose
- Java 21
- Python 3.11+
- Node.js 20+

### 시작하기

```bash
# 1. 레포 클론
git clone https://github.com/dlwldn30/cloumy.git
cd cloumy

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 필요한 API 키 입력

# 3. DB · Redis 실행
make up

# 4. 백엔드 실행
cd backend
gradle bootRun

# 5. AI 서비스 실행
cd ai
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 환경 변수

`.env.example`을 참고해 `.env`를 만들어 주세요.

| 변수 | 설명 | 필수 |
|------|------|------|
| `POSTGRES_PASSWORD` | DB 비밀번호 | ✅ |
| `JWT_SECRET` | JWT 서명 키 (32자 이상 랜덤 문자열) | ✅ |
| `INTERNAL_API_KEY` | Spring ↔ FastAPI 내부 통신 키 | ✅ |
| `ANTHROPIC_API_KEY` | Claude API 키 | ✅ |
| `OPENAI_API_KEY` | 임베딩 전용 (text-embedding-3-small) | ✅ |
| `KAKAO_REST_API_KEY` | 카카오 로컬 API · OAuth | ✅ |
| `GOOGLE_MAPS_API_KEY` | 지도 렌더링 | 지도 기능 시 |
| `TOSS_PAYMENTS_SECRET_KEY` | 결제 | 결제 기능 시 |
| `WEATHER_API_KEY` | 기상청 API | 챗봇 날씨 연동 시 |

---

## 비즈니스 모델

AI 루트 생성·저장은 **트립 패스** 결제 후 사용 가능합니다.
미리보기는 패스 없이도 무료로 제공하며, 신규 가입 시 당일치기 패스 1회 자동 지급됩니다.

| 상품 | 가격 | 대상 |
|------|------|------|
| 당일치기 | 1,900원 | 하루 여행 |
| 3박 이하 | 4,900원 | 2~3박 여행 |
| 4박 이상 | 7,900원 | 장기 여행 · 해외 |

---

## 로드맵

### Phase 0 — 환경 설정 (Week 1~2)
- [x] 모노레포 구조 세팅
- [x] Docker Compose 로컬 환경 (PostgreSQL + pgvector, Redis)
- [x] Spring Boot 프로젝트 초기화
- [x] JWT + OAuth 2.0 인증 구현
- [x] 트립 패스 검증 로직
- [ ] GitHub Actions CI/CD
- [ ] FastAPI 프로젝트 초기화
- [ ] React Native + Expo 초기화
- [ ] DB 스키마 마이그레이션 (Flyway)

### Phase 1 — 데이터 파이프라인 + AI 루트 생성 (Week 3~10)
- [ ] TourAPI / 카카오 로컬 / KOPIS 데이터 수집기
- [ ] OpenAI 임베딩 생성 → pgvector 저장
- [ ] RAG 파이프라인 (pgvector 유사도 검색)
- [ ] OR-Tools TSP 동선 최적화
- [ ] 루트 생성 스트리밍 (WebSocket)
- [ ] Pin & Reshuffle
- [ ] 지도 시각화 (react-native-maps)

### Phase 2 — AI 챗봇 + 예산 관리 (Week 9~14)
- [ ] LangChain 멀티턴 챗봇
- [ ] Function Calling (장소 검색, 지출 기록, 대안 추천)
- [ ] 예산 자연어 파싱 (Haiku)
- [ ] Hidden Gems + 태그 커뮤니티
- [ ] GPS 인증 (반경 100m 서버 사이드 검증)

### Phase 3 — 결제 + 그룹 모드 + 출시 (Week 15~18)
- [ ] 토스페이먼츠 웹뷰 결제
- [ ] 소셜 로그인 완성 (카카오 · 구글 · 애플)
- [ ] 그룹 여행 모드 (WebSocket + Redis Pub/Sub)
- [ ] 오프라인 저장 (4박 이상 패스)
- [ ] 앱스토어 · 플레이스토어 심사 제출

---

## 개발 가이드

### 브랜치 전략

```
main                        # 배포 브랜치
feat/이슈번호-작업-내용      # 새 기능
fix/이슈번호-작업-내용       # 버그 수정
chore/이슈번호-작업-내용     # 설정·빌드·운영
```

### 커밋 컨벤션

```
feat: ✨ 로그인 API 구현
fix: 🔨 피드 조회 500 에러 수정
chore: 🧹 예외 응답 코드 정리
docs: 📝 README 업데이트
refactor: ♻️ 인증 로직 분리
```

### 이슈 & PR

```
이슈:   [✨ Feat] 로그인 API 구현
브랜치: feat/12-login-api
PR:     [✨ Feat] 로그인 API 구현 (#12)
```

PR 본문에 `Closes #이슈번호` 필수 (merge 시 이슈 자동 닫힘)

---

## 문서

| 파일 | 내용 |
|------|------|
| `docs/00-overview.md` | 프로젝트 개요 · 비즈니스 모델 · KPI |
| `docs/01-prd.md` | 기능 명세 · 우선순위 (P0/P1/P2) |
| `docs/02-architecture.md` | 시스템 구조 · 기술 결정 (ADR) |
| `docs/03-data-model.md` | DB 스키마 · 엔티티 정의 |
| `docs/04-api-spec.md` | API 엔드포인트 명세 |
| `planning/milestones.md` | Phase별 개발 마일스톤 (18주) |

---

## 라이선스

© 2026 Cloumy. All rights reserved.

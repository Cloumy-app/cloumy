# 인프라 참고서

Cloumy MVP ~ Phase 2 인프라 구성 및 전환 전략을 정리한다.

---

## MVP 초반 (0~3개월) — EC2 단일 서버 + Docker Compose

### 서버 사양

| 항목 | 선택 | 이유 |
|------|------|------|
| 인스턴스 | AWS EC2 t3.large | FastAPI(LangChain + OR-Tools) 1.5~2GB + Spring 1GB + PostgreSQL 1GB → t3.medium(4GB)은 OOM 위험 |
| vCPU | 2 | |
| RAM | 8GB | |
| 스토리지 | gp3 30GB | PostgreSQL 데이터 볼륨 포함 |
| 리전 | ap-northeast-2 (서울) | 국내 사용자 레이턴시 최소화 |

### 컨테이너 구성

```
EC2 t3.large
│
├── Nginx (:80, :443)
│     SSL 종단 (Let's Encrypt Certbot)
│     리버스 프록시 → Spring / FastAPI
│
├── Spring Boot (:8080, 내부)
│     cloumy-backend Docker 이미지
│
├── FastAPI (:8000, 내부)
│     cloumy-ai Docker 이미지
│     ※ 외부 직접 노출 없음 — Spring 내부 네트워크로만 호출
│
├── PostgreSQL 16 + PostGIS 3.4 (:5432, 내부)
│     postgis/postgis:16-3.4 공식 이미지
│     pgvector는 초기화 SQL로 CREATE EXTENSION vector
│     볼륨: postgres_data (named volume)
│
└── Redis 7 (:6379, 내부)
      maxmemory 512mb, allkeys-lru 정책
```

### docker-compose.prod.yml

```yaml
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - spring
      - fastapi

  spring:
    image: ghcr.io/cloumy/backend:${IMAGE_TAG:-latest}
    env_file: .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  fastapi:
    image: ghcr.io/cloumy/ai:${IMAGE_TAG:-latest}
    env_file: .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: cloumy
      POSTGRES_USER: cloumy
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    restart: unless-stopped

volumes:
  postgres_data:
```

### Nginx 핵심 설정

```nginx
# SSE 스트리밍 (루트 생성) — 버퍼링 반드시 off
location /v1/routes/generate {
    proxy_pass         http://spring:8080;
    proxy_buffering    off;
    proxy_cache        off;
    proxy_set_header   Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
}

# 일반 API
location /v1/ {
    proxy_pass http://spring:8080;
}
```

### DB 초기화 SQL (db/init.sql)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## CI/CD — GitHub Actions

### 흐름

```
main 브랜치 푸시 (PR 머지)
  ↓
GitHub Actions
  1. Docker 이미지 빌드 (backend, ai 각각)
  2. GHCR 푸시 (ghcr.io/cloumy/backend:sha, :latest)
  3. EC2 SSH 접속 (GitHub Secrets: EC2_HOST, EC2_SSH_KEY)
  4. docker compose pull
  5. docker compose up -d
  ↓
배포 완료 (컨테이너 재시작 ~10초 다운타임 허용, MVP 기준)
```

### 환경 변수 관리

- **로컬 개발**: `.env.local` (git ignore)
- **프로덕션**: GitHub Secrets → Actions에서 EC2의 `.env` 파일 생성 후 주입
- `.env.example`을 항상 최신 유지 (실제 값 없이 키 목록만)

### GitHub Actions 워크플로우 구조

```
.github/workflows/
├── ci.yml          # PR 시: 린트, 테스트 (Spring gradlew test, FastAPI pytest)
└── deploy.yml      # main 머지 시: 빌드 → GHCR 푸시 → EC2 배포
```

---

## 로컬 개발 환경

```yaml
# docker-compose.yml (로컬용 — DB/Redis만 실행)
services:
  postgres:
    image: postgis/postgis:16-3.4
    ports: ["5432:5432"]       # 로컬에서 직접 접근 가능
    environment:
      POSTGRES_DB: cloumy
      POSTGRES_USER: cloumy
      POSTGRES_PASSWORD: password

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

Spring Boot, FastAPI는 로컬에서 직접 실행:
```bash
# Spring
./gradlew bootRun

# FastAPI
uvicorn app.main:app --reload --port 8000
```

---

## Phase 2 전환 계획 (MAU 증가 후)

| 트리거 | 변경 내용 | 이유 |
|--------|-----------|------|
| EC2 CPU 70%+ 상시 or MAU 5천 | PostgreSQL → AWS RDS (Aurora PostgreSQL) | DB 관리형 전환, 자동 백업, 리드 레플리카 |
| 배포 중 다운타임 문제 or MAU 1만 | ECS Fargate로 Spring/FastAPI 컨테이너 분리 | 독립 스케일링, 무중단 배포 |
| Redis OOM 빈번 | ElastiCache Redis | 관리형, 클러스터 모드 |
| 로그 수집 필요 | CloudWatch Logs 연동 | 구조화 로그, 알람 설정 |

### RDS 마이그레이션 방법 (무손실)

```bash
# 1. EC2 PostgreSQL → RDS pg_dump
pg_dump -h localhost -U cloumy cloumy > cloumy_backup.sql

# 2. RDS에 복원
psql -h {rds-endpoint} -U cloumy cloumy < cloumy_backup.sql

# 3. 환경 변수만 교체 (POSTGRES_URL → RDS 엔드포인트)
# 4. docker-compose에서 postgres 서비스 제거
```

Docker volume에 데이터를 저장하기 때문에 이 방법으로 무손실 이전 가능.

---

## 비용 요약

### MVP (월 기준)

| 항목 | 비용 |
|------|------|
| EC2 t3.large (온디맨드) | ~$60 |
| 도메인 + Route 53 | ~$1.5 |
| GHCR (500MB 이하) | 무료 |
| **인프라 합계** | **~$62/월** |

| 항목 | 비용 |
|------|------|
| Claude API (혼합 + Prompt Caching) | ~$170~250 |
| Google Maps Platform | ~$100~200 |
| 카카오 로컬 API | 무료 (300k 트랜잭션 이내) |
| 기상청 API | 무료 |
| OpenAI 임베딩 (배치 1회성) | ~$2~3 |
| **서비스 합계** | **~$270~450/월** |

### Phase 2 (MAU 1만 기준 월 예상)

| 항목 | 비용 |
|------|------|
| ECS Fargate (Spring + FastAPI) | ~$80~120 |
| RDS Aurora PostgreSQL (t3.medium) | ~$60 |
| ElastiCache Redis (t3.micro) | ~$20 |
| **인프라 합계** | **~$160~200/월** |

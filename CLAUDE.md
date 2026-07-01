# Cloumy 프로젝트 전체 구조

## 서비스 구성
- frontend/ — React Native + Expo SDK 56 (모바일 앱)
- backend/ — Spring Boot 3, Java 21 (REST API, 포트 8080)
- ai/ — FastAPI + LangChain (AI 루트 생성, 포트 8000)
- db/ — PostgreSQL + PostGIS + pgvector

## 서비스간 통신
- 앱 → backend: REST API (JWT Bearer 인증)
- backend → ai: HTTP + `X-Internal-Key` 헤더 (내부 인증)
- 루트 생성: backend SSE → 앱, backend가 ai NDJSON 스트림을 중계

## 로컬 실행 순서
1. `docker-compose up -d` — PostgreSQL, Redis
2. `cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'`
3. `cd ai && uvicorn app.main:app --reload --port 8000`
4. `cd frontend && npx expo run:ios`

## API 응답 포맷 (backend)
- 성공: `{ "success": true, "data": {...} }`
- 실패: `{ "success": false, "error": { "code": "...", "message": "..." } }`

## 공통 규칙
- API 변경 시 docs/04-api-spec.md 동기화 필수
- 커밋·PR 전 사용자 승인 필수
- 환경변수 파일(.env) 절대 커밋 금지

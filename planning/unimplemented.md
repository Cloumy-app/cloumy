# 미구현 목록 / 추후 처리 필요 항목

> 구현 중 발견된 임시 처리 항목, 프로덕션 전 반드시 완료해야 하는 작업 목록.
> 완료 시 해당 항목 삭제 또는 ~~취소선~~ 처리.

---

## 🔴 프로덕션 전 필수

### 1. Apple identity token 서명 검증 미구현
- **파일**: `backend/src/main/java/com/cloumy/auth/oauth/AppleOAuthClient.java`
- **현재 상태**: identity token(JWT)의 서명을 검증하지 않고 Base64 payload만 디코딩해서 사용
- **위험**: 위조된 identity token으로 타인 계정 탈취 가능
- **해야 할 것**: Apple 공개키 JWK endpoint(`https://appleid.apple.com/auth/keys`)에서 공개키를 가져와 RS256 서명 검증 추가
- **참고**: JJWT 또는 `com.nimbusds:nimbus-jose-jwt` 라이브러리 사용 권장

---

## 🟠 테스트 미완료

### 2. JWT 인증 흐름 엔드-투-엔드 테스트 미완료
- **관련 태스크**: JWT 인증 미들웨어 구현
- **현재 상태**: 코드 구현은 완료, 실제 서버 구동 후 테스트 미진행
- **테스트해야 할 흐름**:
  1. `POST /v1/auth/social` → Access/Refresh Token 발급 확인
  2. 발급된 Access Token으로 보호된 API 호출 → 200 확인
  3. 만료된 Access Token 사용 → 401 `TOKEN_EXPIRED` 확인
  4. `POST /v1/auth/refresh` → 새 Access Token 발급 확인
  5. `POST /v1/auth/logout` → Redis 블랙리스트 등록 확인
  6. 로그아웃된 Refresh Token으로 갱신 시도 → 401 `TOKEN_REVOKED` 확인

---

## 🟡 개발 환경 복원 필요

### 2. PostgreSQL 포트 5433 → 5432 복원
- **원인**: 다른 프로젝트(fintech_db) 실습 중 5432 포트 충돌로 임시 변경
- **수정할 파일**:
  - `docker-compose.yml` → `5433:5432` → `5432:5432`
  - `.env` → `localhost:5433` → `localhost:5432`
  - `.env.example` → `localhost:5433` → `localhost:5432`
- **복원 후**: `docker compose down && docker compose up -d` 실행

---

---

## 🔵 API 키 미발급 (시기별 등록 필요)

> 발급 후 `.env`, `ai/.env`, GitHub Secrets 세 곳에 동일하게 등록할 것.

### 3. 토스페이먼츠 시크릿 키 (`TOSS_PAYMENTS_SECRET_KEY`)
- **등록 시기**: Week 15~16 결제 구현 시
- **발급처**: developers.tosspayments.com → 개발 → 테스트 시크릿 키
- **등록 위치**: `.env` + GitHub Secrets

### 4. Apple 로그인 키 4종 (`APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY`)
- **등록 시기**: 앱스토어 배포 직전 (Week 17~18)
- **발급처**: developer.apple.com → Certificates, Identifiers & Profiles → Keys
- **등록 위치**: `.env` + GitHub Secrets
- **주의**: `APPLE_PRIVATE_KEY`는 `.p8` 파일 내용을 줄바꿈 `\n` 이스케이프 후 입력

### 5. 네이버 로그인 키 (`NAVER_CLIENT_ID / NAVER_CLIENT_SECRET`)
- **등록 시기**: 소셜 로그인 구현 시 (Week 15~16)
- **발급처**: developers.naver.com → 애플리케이션 → 로그인 API 신청
- **등록 위치**: `.env` + GitHub Secrets

### 6. 네이버 블로그 검색 API (`NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET`)
- **등록 시기**: Phase 1 후반 — 트렌딩 장소 수집 파이프라인 구현 시
- **발급처**: developers.naver.com → 검색 API 신청 (네이버 로그인 앱과 동일 앱 가능)
- **등록 위치**: `ai/.env` + GitHub Secrets

### 7. EC2 배포 인프라 키 (`EC2_HOST / EC2_SSH_KEY`)
- **등록 시기**: EC2 서버 구성 시 (배포 준비 단계)
- **발급처**: AWS EC2 콘솔 → 인스턴스 생성 → 키 페어 생성
- **등록 위치**: GitHub Secrets 전용 (로컬 .env 에는 불필요)
- **주의**: `EC2_SSH_KEY`는 `.pem` 파일 전체 내용 붙여넣기

---

*마지막 업데이트: 2026-06-18*

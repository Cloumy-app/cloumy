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

---

## 🔵 데이터 파이프라인 보강 (TourAPI 수집 후속)

### (번호추가) TourAPI detailCommon2 상세 보강 수집
- **관련 태스크**: TourAPI 배치 수집기 구현 (2026-06-21 완료)
- **현재 상태**: `areaBasedList2`로 기본 좌표·주소·태그만 수집 (20,363건). 설명·영업시간·전화번호 미수집
- **해야 할 것**: `detailCommon2` 엔드포인트 병렬 호출 → `places.business_hours`, 상세 설명 컬럼 채우기
- **참고**: 일일 트래픽 1,000건 제한 → 배치 분할 실행 필요 (20,363건 / 1,000 = 21일 소요)

### (번호추가) places 테이블 유니크 제약 + upsert 전환
- **관련 태스크**: TourAPI 배치 수집기 구현 (2026-06-21 완료)
- **현재 상태**: places 테이블에 유니크 제약 없어 수집기 재실행 시 중복 INSERT 발생
- **해야 할 것**: Flyway 마이그레이션으로 `(source, name, location)` 유니크 제약 추가 → `ON CONFLICT DO UPDATE` 전환
- **우선순위**: 중간 (현재 시드 데이터는 1회 실행으로 충분, 정기 갱신 시 필요)

### (번호추가) 루트 추천 장소 풀이 100% TourAPI 단일 소스
- **관련 태스크**: 숙소 입력(Accommodation) 기능 구현 중 발견 (2026-07-03)
- **현재 상태**: `places` 20,363건 전부 `source='tourapi'`. 카카오 보강 수집기(`collect_kakao.py`, 2026-06-29 실행)는 반경 150m 내 기존 TourAPI 장소와 겹쳐 신규 삽입 0건, 좌표 교정만 수행됨. `is_hidden_gem=true`도 0건(Hidden Gems 기능은 자금 확보 전까지 연기 — `#8` 항목 참고).
- **영향**: AI 루트 생성(`PgvectorRetriever`/`PostgisTagRetriever`)이 추천 가능한 장소가 전부 관광공사 등록 기준 장소뿐 — 로컬한 숨은 장소가 구조적으로 루트에 안 들어감.
- **해야 할 것(논의 필요)**: 카카오 보강을 더 넓은 반경/다양한 키워드로 재실행 검토, 또는 추가 데이터소스 검토(구글 플레이스 등, 앞서 보류 결정된 항목과 동일 맥락). 숙소 입력/이동시간 태스크들 마무리 후 별도로 논의하기로 함(2026-07-03 대화에서 사용자가 명시적으로 보류).
- **우선순위**: 중간 — 서비스 핵심 가치(Hidden Gems 큐레이션)와 직결되지만 당장 기능 동작에는 문제없음

---

## 🟣 자금 확보 후 구현 (모두의 창업 지원금 이후)

### 8. Hidden Gems 기능 전체
- **연기 이유**: 모두의 창업 1차 지원금 미확보 → GPS 인증 기반 커뮤니티 구축 비용 부담
- **구현 범위**:
  - GPS 인증 기반 현지 발견 장소 등록 (photo + 좌표 인증)
  - 희소성 점수 알고리즘 (`rarity_score`) 운영
  - Hidden Gem 배지 자동 부여/해제 + FCM 알림 ("핫플이 됐어요 🔥")
  - `user_levels` 테이블 기반 레벨 시스템
- **단, 데이터 모델은 유지**: `places.rarity_score`, `places.is_hidden_gem`, `hidden_gems` 테이블은 그대로 두고 로직만 비활성화
- **해외에서 더 중요**: 언어 장벽 + 정보 비대칭 환경에서 Hidden Gems 가치가 국내보다 높음 → 해외 피벗 시 우선 적용

---

*마지막 업데이트: 2026-06-21*

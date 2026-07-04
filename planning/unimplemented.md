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

## 🔵 이동시간 기능 후속 (Tmap 대중교통 연동 후속 — 2026-07-04)

### (번호추가) 탭하면 상세 노선 + 실시간 도착정보
- **관련 태스크**: 이동수단별 이동시간 반영 (2026-07-04 완료)
- **현재 상태**: 슬롯 사이 이동시간(도보/자동차 근사치 + 대중교통 Tmap API)만 표시. "몇 번 버스/몇 호선"이나 "3분 후 도착" 같은 상세·실시간 정보는 없음
- **해야 할 것**: 경로 상세(노선/환승)는 Tmap 대중교통 API 응답의 `legs`를 추가로 파싱하면 됨. 실시간 도착 카운트다운은 별도 데이터소스 필요(서울은 서울 열린데이터광장 지하철/버스 실시간 API, 타 지역은 지자체별로 다름 — 전국 커버 시 국가교통정보센터 TAGO 통합 고려) + "탭할 때마다 재조회"하는 온디맨드 엔드포인트 신설 필요(정적 계산 불가)
- **우선순위**: 낮음 — 외국인 관광객 핵심 pain point는 "뭘 타야 할지 모름"이지 실시간 정밀도가 아님(한국관광공사 조사 기준)

### (번호추가) 해외 목적지 확장 시 이동시간 provider 분기
- **관련 태스크**: 이동수단별 이동시간 반영 (2026-07-04 완료)
- **현재 상태**: `transport_service.py`가 Tmap(한국 전용)만 지원. 구글맵은 한국에서 도보 길찾기 자체가 안 되지만(정밀지도 반출 규제), 해외에서는 정상 동작함
- **해야 할 것**: 해외 도시 지원 시 목적지 국가에 따라 provider를 Tmap→Google Maps로 분기하는 로직 추가. 지금은 100% 국내 전용이라 시기상조(YAGNI)
- **우선순위**: 낮음 — 해외 확장이 확정되면 재검토

### (번호추가) 다일차 루트 생성 중 day 경계 추적 꼬임 재발 관찰
- **관련 태스크**: 이동수단별 이동시간 반영 검증 중 발견 (2026-07-04)
- **현재 상태**: `route_service.py`가 Claude 스트리밍 중 place_id 오류로 인한 자기교정(출력 재시작)을 처리하는데, 재시작이 여러 번 겹치면 마지막 day의 `day_buffer`가 불완전한 상태로 flush되는 사례를 실제로 관찰함(대구 2박 생성 테스트에서 day2 슬롯의 이동시간 필드가 전부 비어있었음 — 슬롯 자체는 저장됐으나 enrichment 대상에서 빠짐).
- **비슷한 기존 이슈**: `milestones.md`의 "다일차 루트 생성 안정성 버그 3건"(2026-07-02 완료 처리됨)과 같은 종류로 보이나 완전히 해결되지 않은 것으로 보임
- **해야 할 것**: 재현 케이스 확보 후 `_process_line`/`_ingest`의 day 경계 판정 로직 재검토 필요. 이번 태스크 범위 밖이라 별도 조사 필요
- **우선순위**: 중간 — 드물게 발생하고 크래시는 아니지만(슬롯 자체는 저장됨) 데이터 정합성 문제

---

## 🔵 숙소 기능 후속 (다중 숙소 지원 — 2026-07-04)

### (번호추가) 날짜 구간별 숙소가 다른 경우 지원
- **관련 태스크**: 숙소 입력 + 이동시간 정확도 개선 (2026-07-04 완료) — 실사용 피드백으로 발견
- **현재 상태**: 숙소는 "여행당 1건"만 지원. `accommodations` 테이블 자체는 `check_in_date`/`check_out_date` 구간을 가진 레코드 구조라 여러 건 저장이 스키마상 불가능하진 않지만, 프론트 입력 UI·AI TSP 앵커 로직(`tsp_service.py`)·Spring 저장 로직 전부 "숙소 1개가 여행 시작~종료일 전체를 커버"한다고 전제하고 구현돼 있음
- **해야 할 것(논의 필요)**:
  - 프론트: 숙소 입력 UI를 "여행당 1개" → "날짜 구간별 여러 개 추가" 폼으로 변경
  - AI: TSP 앵커가 지금은 "하루 buffer 전체에 앵커 좌표 1개"를 전제하는데, day별로 해당 day가 속한 숙소 구간을 찾아 다른 앵커 좌표를 매핑하도록 변경
  - Spring: 숙소 저장/조회 API를 리스트 기반으로 변경, day → 숙소 매핑 로직 추가
- **우선순위**: 낮음 — 지금은 "숙소 1건"으로도 대부분의 국내 여행(1~2박, 동일 지역 숙박) 케이스는 커버됨. 여러 도시를 이동하는 장기 여행(3박 이상, 지역 이동형) 비중이 늘면 재검토

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

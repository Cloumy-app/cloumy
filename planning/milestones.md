# 개발 마일스톤 (Cloumy MVP, 18주)

> **North Star Metric: WAR (Weekly Active Routers)** — 주간 활성 루트 생성 사용자 수
> **MVP KPI 목표**: MAU 1만 / 루트 생성 5천건/월 / D7 리텐션 30% / 트립 패스 전환율 10% / 월 결제 300건+

---

## Pre-launch: 출시 -3개월 (베타 준비)

### 목표
Hidden Gems 콜드스타트 방지 + 핵심 가정 사전 검증

### 체크리스트

**베타 헌터 모집**
- [ ] 여행 마니아 (페르소나 F) 300명 모집 목표
  - 모집 채널: 인스타·네이버 블로그·여행 커뮤니티(네이버 카페) 직접 DM
  - 여행 블로거, 인스타 여행 계정, 여행 커뮤니티 활동자 대상
- [ ] 베타 과제 안내: Hidden Gems 장소 인당 5개 이상 등록
- [ ] 인센티브 확정: 정식 출시 후 "창립 멤버" 배지 + 레전드 등급 즉시 부여 + 3개월 무료 패스
- [ ] 목표: 출시 시점에 Hidden Gems **500~1,000개** 이상 확보 (지역 분산 포함)

**사용자 인터뷰 (핵심 가정 검증)**
- [ ] 인터뷰 10명 이상 완료
  - "여행 중 일정 이탈 경험 비율" → 목표 70%+ 확인
  - "기존 앱 불만족 비율" → 목표 50%+
  - "여행당 4,900원 결제 의향" → 목표 30%+

---

## Phase 0: 환경 설정 (Week 1~2)

### 목표
코딩 시작 전 인프라와 개발 환경 완비

### 체크리스트

**프로젝트 초기화**
- [ ] GitHub 레포지토리 생성 (cloumy-app, cloumy-backend, cloumy-ai)
- [ ] GitHub Actions CI/CD 파이프라인 설정
- [x] Docker Compose 로컬 환경 구성 (PostgreSQL + PostGIS + pgvector, Redis)
- [ ] Spring Boot 프로젝트 초기화 (Gradle, 의존성)
- [ ] FastAPI 프로젝트 초기화 (requirements.txt)
- [ ] React Native + Expo 프로젝트 초기화

**DB 설정**
- [x] PostgreSQL + PostGIS + pgvector 설치 및 설정
- [x] 핵심 테이블 스키마 마이그레이션 (Flyway) — V1~V5 완료 (2026-06-21)
  - users(V1), places(V2), routes+bookmarks(V3), route_slots+expenses+budget_settings(V4)
  - payments, group_trips, group_members, hidden_gems — Phase 2/3에서 추가 예정
- [x] 인덱스 생성 (PostGIS GiST, GIN 5종, ivfflat, 부분 인덱스 등 총 29개)

**API 키 및 환경 변수**
- [x] Anthropic API 키 발급 (Claude Sonnet 4.6 / Haiku 4.5)
- [x] OpenAI API 키 발급 (임베딩용 — text-embedding-3-small)
- [x] Google Maps Platform 키 발급
- [x] 카카오 개발자 앱 생성 (OAuth, 로컬 API, 모빌리티 API)
- [x] TourAPI 키 발급 (한국관광공사, 무료)
- [ ] KOPIS Open API 키 발급 (공연예술통합전산망, 무료)
- [x] OpenWeatherMap API 키 발급 (무료 티어, 일 1,000콜 — 국내·해외 통합, 기상청 대체)
- [ ] 네이버 블로그 검색 API 키 발급 (트렌딩 장소 파이프라인용, 무료)
- [ ] AWS S3 버킷 생성
- [ ] FCM 프로젝트 설정
- [ ] 토스페이먼츠 개발자 계정 등록

---

## Phase 1: AI 루트 생성 + 데이터 파이프라인 (Week 3~10)

### 목표
Cloumy의 핵심 가치 — AI 루트 생성 완성 (앱 확인 중심 반복 개선)

### Week 3~4: AI 루트 생성 Phase A (LangChain LCEL + PostGIS 태그 MVP)

> **전략**: embedding 없이 즉시 구현 → 앱에서 확인 → Phase B에서 Retriever만 교체

- [x] FastAPI `models/schemas.py` — `RouteGenRequest` Pydantic 모델
- [x] FastAPI `services/retrievers.py` — `PostgisTagRetriever(BaseRetriever)`: `ST_DWithin + category_tags &&`
- [x] FastAPI `services/route_service.py` — CITY_CENTERS 하드코딩 + Haiku LCEL 태그 추출 + Sonnet SDK 스트리밍 (cache_control 안정성으로 LCEL 대신 직접 사용)
- [x] FastAPI `routes/route_gen.py` — `POST /ai/routes/generate` StreamingResponse (ndjson)
- [x] FastAPI `main.py` 수정 — `include_router` 추가
- [x] Spring `Route.java` 엔티티 + `RouteRepository.java` (2026-06-22, `trip/entity/`)
- [x] Spring `AiServiceClient.java` — Java 21 HttpClient blocking + 가상 스레드 (2026-06-22, WebClient 아님)
- [x] Spring `RouteController.java` — `POST /v1/routes/generate` MVC SseEmitter + 가상 스레드 (2026-06-22)
- [x] `application.yml` — `app.fastapi.url`, `app.internal-api-key` 추가 (2026-06-22)

### Week 5: 앱 확인 + 품질 평가

- [x] 앱에서 SSE 스트리밍 실제 확인 (백엔드 curl E2E 완료 2026-06-25 — React Native 연동은 프론트엔드 초기화 후)
- [ ] 루트 결과 품질 평가 (카테고리 다양성, 동선 합리성)
- [ ] Phase B 진행 여부 결정 (품질 충분하면 Phase C 품질 개선으로 바로 이동 가능)

### Week 6~7: 데이터 파이프라인 보강 + Phase B 준비

- [ ] 카카오 로컬 API 수집기 구현 (3일 1회)
  - ⚠️ 현재 일 10만건 무료, 2026년 말 이후 건당 50원 전환 예정 — 쿼터 관리 필요
- [ ] KOPIS Open API 수집기 구현 (공연·콘서트·뮤지컬 일정, 1일 1회)
- [ ] 중복 장소 병합 로직 (PostGIS 반경 100m)
- [ ] 카테고리 태그 변환 테이블 구현
- [ ] 좌표 검증 (PostGIS 행정구역 포함 여부)
- [ ] OpenAI 임베딩 배치 생성 (20,363건 × text-embedding-3-small, ~$2~3)

### Week 7~8: AI 루트 생성 Phase B (pgvector Retriever 교체) + OR-Tools TSP

- [ ] `retrievers.py`에 `PgvectorRetriever` 추가 (embedding `<=>` 유사도)
- [ ] `route_service.py`에서 Retriever 한 줄 교체 (나머지 체인 동일)
- [ ] 멀티소스 병렬: pgvector 30개 + PostGIS 20개 + tag fallback

### Week 8~9: OR-Tools TSP + 슬롯 대안 추천

- [ ] OR-Tools TSP 동선 최적화 구현
  - 앵커 장소 고정 로직
  - 일정 밀도(density) 파라미터 반영
  - KOPIS 공연 시간 앵커 자동 배치 (페르소나 C 대응)
- [ ] 루트 결과 지도 시각화 (react-native-maps)
  - Day별 색상 구분 경로선
  - 방문 순서 번호 핀
  - Day 탭 필터
- [ ] 타임라인 뷰 (하단 슬라이드업)
- [ ] 슬롯 대안 추천 API 구현 `POST /ai/routes/slots/{slot_id}/alternatives` (Haiku)
  - 슬롯 단위 대안 3개 추천 → 사용자 선택 → 인접 이동시간만 재계산
  - is_pinned=true 슬롯은 대안 추천 불가
- [ ] 슬롯 📌🔄❌ 액션 UI 구현
- [ ] 환각 방지 검증 (place_id 재조회)

### Week 10~11: 루트 생성 완성도 향상

- [ ] 스트리밍 응답 (WebSocket, Day별 순차)
- [ ] 응답 속도 최적화 (Redis 루트 캐시)
- [ ] 예산 초과 장소 처리 (소프트/하드 초과)
- [ ] 방문 빈도 질문 UI (루트 생성 Step 3) — "얼마나 자주 가세요?" → Hidden Gems 비율 제어 (Hidden Gems 기능 자체는 연기)
- [ ] 장소 카드 팝업 (사진, 체류 시간, 예상 비용, Hidden Gem 여부)
- [ ] 카카오맵 딥링크 내비 연동
- [ ] 단위 테스트 작성 (루트 생성 핵심 로직)

---

## Phase 2: AI 챗봇 + 예산 관리 (Week 9~14)

### Week 9~12: AI 챗봇

- [ ] LangChain 멀티턴 챗봇 파이프라인
- [ ] Redis 세션 관리 (메시지 히스토리, 컨텍스트)
- [ ] Function Calling 도구 구현
  - search_nearby_places, record_expense, get_remaining_budget, suggest_alternatives
- [ ] 챗봇 스트리밍 WebSocket 구현
- [ ] 여행 중 현위치 기반 장소 추천 (OpenWeatherMap API 연동)
- [ ] 예산 자연어 파싱 (Haiku, "기념품 12,000원 썼어" → 자동 분류)
- [ ] 챗봇 UI 구현 (ChatBubble, 스트리밍 애니메이션)
- [ ] 지출 파싱 확인 팝업 UI

### Week 11~13: 예산 관리 & 지출 추적

- [ ] 총예산 입력 + AI 카테고리 자동 배분 UI
- [ ] 태그별 비율 자동 조정 (#먹방 → 식음료 +10%)
- [ ] 슬라이더 비율 조정 UI
- [ ] 계획 지출 완료 체크 / 금액 수정
- [ ] 비계획 지출 + 버튼 입력 폼
- [ ] 잔여 예산 배너 (상시 표시, 초과 시 색상 변경)
- [ ] 여행 후 지출 리포트 (Victory Native 차트)
- [ ] 예산 초과 시 챗봇 저가 대안 자동 제안

### Week 13~14: Hidden Gems + 태그 커뮤니티

> ⚠️ **자금 확보 후 진행 (모두의 창업 지원금 이후 — 현재 연기)**
> DB 테이블/컬럼은 유지, 로직만 비활성화. 해외 피벗 시 우선 적용.

- [ ] Hidden Gem 장소 등록 API (GPS 인증 **반경 100m** 검증, S3 사진 업로드)
- [ ] 서버 사이드 GPS 좌표 검증 (PostGIS, 반경 100m 이내만 인정)
- [ ] 희소성 점수 계산 알고리즘 구현
- [ ] Hidden Gems 피드 UI (태그 필터)
- [ ] 레벨 시스템 구현 (탐험가 → 로컬가이드 → 레전드)
- [ ] "핫플이 됐어요" FCM 알림 (희소성 점수 50 미만)
- [ ] 베타 테스터 레전드 배지 자동 부여

---

## Phase 3: 결제 + 그룹 모드 + 출시 준비 (Week 15~18)

### Week 15~16: 결제 + 인증 완성

- [ ] 토스페이먼츠 웹뷰 결제 구현
- [ ] 서버 사이드 결제 검증 API (토스페이먼츠 서버 검증 필수)
- [ ] 트립 패스 활성화 로직 (pass_type, pass_expires_at)
- [ ] 환불 처리 (여행 start_date 기준 자동 판단)
- [ ] PassGate UI (트립 패스 필요 기능 게이트)
- [ ] 소셜 로그인 완성 (카카오·구글·애플)
- [ ] 인증 플로우 완성 (JWT, Refresh Token)

### Week 17~18: 그룹 여행 모드 + 오프라인 저장 + 출시

- [ ] 그룹 여행방 생성 + 초대 링크/QR
- [ ] 실시간 동기화 WebSocket (Redis Pub/Sub)
- [ ] 슬롯 좋아요/싫어요 투표 UI
- [ ] 개인별 지출 추적 (그룹 뷰)
- [ ] 오프라인 저장 구현 (4박 이상 패스)
- [ ] 통합 테스트 (전체 플로우)
- [ ] 성능 테스트 (동시 접속, LLM 응답 속도)
- [ ] 앱스토어·플레이스토어 심사 제출 준비
  - 스크린샷, 개인정보 처리방침, 앱 설명

---

## 베타 출시 전 필수 체크리스트

- [ ] AI 루트 생성 10초 이내 응답 확인
- [ ] 챗봇 2초 이내 (Haiku), 5초 이내 (Sonnet) 응답 확인
- [ ] 결제 플로우 엔드투엔드 테스트
- [ ] GPS 인증 위조 방어 테스트 (반경 100m 서버 사이드 검증)
- [ ] LLM 프롬프트 인젝션 테스트
- [ ] Hidden Gems 시드 데이터 500개 이상 확보 (300명 베타 헌터)
- [ ] 사용자 인터뷰 10명+ 핵심 가정 검증 완료
- [ ] 개인정보 처리방침 작성 (앱스토어 필수)
- [ ] 앱스토어·플레이스토어 개발자 계정 등록

## MVP 개발 비용 추정 (6개월, 팀 채용 기준)

| 항목 | 인원·기간 | 추정 비용 |
|------|-----------|-----------|
| PM | 1명 × 6개월 | 3,000~4,200만원 |
| 백엔드 개발자 (Spring) | 2명 × 6개월 | 6,000~9,600만원 |
| 프론트 개발자 (RN) | 1명 × 6개월 | 3,000~4,500만원 |
| AI 엔지니어 | 1명 × 6개월 | 3,600~5,400만원 |
| 디자이너 (UX/UI) | 1명 × 4개월 | 2,000~2,800만원 |
| 인프라·외부 API | 6개월 | 600~1,200만원 |
| 마케팅·운영 | 6개월 | 1,000~2,000만원 |
| **총계 (주니어~미드)** | | **약 1.9억~2.9억원** |
| **총계 (시니어 기준)** | | **약 2.5억~3.5억원** |

> 📌 가정: 1인 개발 시 위 비용 없음. AI 기능(루트 생성 + 챗봇)이 전체 개발 기간의 약 50% 차지.

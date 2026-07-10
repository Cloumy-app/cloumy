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

## Phase 0: 환경 설정 ✅ (~2026-06-08 완료)

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

## Phase 1: AI 루트 생성 + 데이터 파이프라인 (2026-06-09 ~)

### 목표
Cloumy의 핵심 가치 — AI 루트 생성 완성 (앱 확인 중심 반복 개선)

### 2026-06-09 ~ 2026-06-22: AI 루트 생성 Phase A ✅ (LangChain LCEL + PostGIS 태그 MVP)

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

### 2026-06-23 ~ 2026-06-25: Phase B + 데이터 파이프라인 + E2E ✅

- [x] OpenAI 임베딩 배치 생성 (20,363건 × text-embedding-3-small) (2026-06-25)
- [x] pgvector ivfflat 인덱스 최적화 (lists=100, ivfflat.probes=10) (2026-06-25)
- [x] `PgvectorRetriever` 추가 + Retriever 한 줄 교체 (Phase B 완료) (2026-06-25)
- [x] OR-Tools TSP 동선 최적화 (Haversine + PATH_CHEAPEST_ARC, day별 독립 최적화) (2026-06-25)
- [x] Redis 캐시 연동 (aioredis TTL 24h + Spring RedisTemplate 폴백) (2026-06-24)
- [x] 환각 방지 검증 `place_validator.py` (메모리 내 O(1) 검증 + None 반환으로 캐시 오염 방지) (2026-06-23)
- [x] Spring SSE E2E 검증 + 버그 3건 수정 (HTTP/2→1.1, ASYNC DispatcherType, aclose→close) (2026-06-25)
- [x] 백엔드 curl E2E 스트리밍 확인 (25슬롯 정상 수신)

### 2026-06-25 ~ 2026-06-27: 프론트엔드 초기화 + 로그인 ✅

- [x] Expo Router + NativeWind 초기화 (2026-06-25) — `app/_layout.tsx`, `(tabs)/`, 루트 생성 Step1/2, 루트 결과 화면
- [x] SSE 스트리밍 수신 (`lib/api/routes.ts`, `react-native-sse`) + RouteStore + SlotCard (2026-06-25)
- [x] **Dev 로그인 + Auth Guard 구현** (2026-06-26) — `(auth)/login.tsx`, auth guard, `lib/api/auth.ts`
- [x] 앱에서 AI 루트 생성 전체 플로우 실제 확인 (로그인 → 루트 생성 → 스트리밍)

### 2026-06-27: 홈 화면 완성 ✅

**[Spring]**
- [x] `GET /v1/routes` — 내 루트 목록 API (최신순 페이징) (2026-06-26)

**[Frontend]**
- [x] `(tabs)/index.tsx` — 유저 닉네임 + 아바타 (`user.nickname` / `profileImageUrl`) (2026-06-26)
- [x] 다가오는 여행 카드 — 루트 목록 최신 1건 (D-n 뱃지, 날짜, 목적지)
- [x] "당신을 위한 추천" 가로 스크롤 카드 (도시 이미지, 정적 데이터)

### 2026-06-27: 루트 결과 화면 완성 (지도 + 타임라인 + Reshuffle) ✅

**[Spring]**
- [x] `GET /v1/routes/{routeId}/slots` — 슬롯 목록 + places JOIN → lat/lng 포함 응답 (2026-06-27)
- [x] `PATCH /v1/routes/{routeId}/slots/{slotId}/pin` — 핀 토글
- [x] `DELETE /v1/routes/{routeId}/slots/{slotId}` — 슬롯 삭제 (pinned 시 400)
- [x] `POST /v1/routes/{routeId}/slots/{slotId}/alternatives` — AI 대안 프록시

**[AI FastAPI]**
- [x] `POST /ai/routes/slots/alternatives` — Haiku 대안 3개 추천 (인접 동선 고려) (2026-06-27)

**[Frontend]**
- [x] `components/map/TripMap.tsx` — react-native-maps 지도 (Day별 색상 Polyline + 번호 Marker) (2026-06-27)
- [x] `components/route/DayTabs.tsx` — Day 탭 + 예상비용/방문 장소 수 요약 카드
- [x] `route/[routeId]/index.tsx` — 지도 + 슬라이드업 타임라인 레이아웃, GET /v1/routes/{id}/slots 연동
- [x] `components/route/SlotCard.tsx` — 🔄 대안 인라인 패널 (3개 선택 → 슬롯 교체)
- [x] 타임라인 카드 탭 → 지도 핀 포커스 연동 — animateToRegion 400ms + 포커스 마커 강조 — 2026-06-27

### 2026-06-30: 데이터 파이프라인 보강 + 장소 디테일 ✅

- [x] 장소 카드 팝업 (PlaceDetailSheet — 장소명·주소·체류시간·히든젬 배지) — 2026-06-27
- [x] 구글 지도 딥링크 내비 연동 (iOS: comgooglemaps://, Android: geo:, 웹 fallback) — 2026-06-27
- [x] 예산 수준 5단계 카드 선택 (초절약~특별하게) + AI 슬롯당 대표값 전달 (`tight`~`luxury`) — 2026-06-28
- [x] 예산 초과 장소 처리 (소프트/하드 초과 배지 — SlotCard) — 2026-06-28
- [x] 방문 빈도 질문 UI (루트 생성 Step 3) — Hidden Gems 비율 제어 — 2026-06-30
- [x] 단위 테스트 작성 (루트 생성 핵심 로직) — 2026-06-28

### ~2026-07-25: 데이터 보강 + 품질 개선

**[FastAPI]**
- [x] 카카오 로컬 보충 수집기 — TourAPI 미수집 맛집/카페 보강 + 좌표 교정 (`scripts/collect_kakao.py`) — 2026-06-29
- [x] 기상청 API 연동 (OpenWeatherMap) — 여행 날짜 예보 기반 실외/실내 장소 가중치 조정 (`services/weather_service.py`) — 2026-06-29
- [x] 날씨 가중치 반영 방식 개선 — 전체 평균 정렬 → Day별 강수확률 프롬프트 반영 (`services/weather_service.py`) — 2026-07-02
- [x] 날씨 라벨 세분화(오전/오후/저녁 블록) + 근시일(5일 이내) 요청 캐시 우회 (`services/weather_service.py`, `services/route_service.py`) — 2026-07-02
- [x] 코드 리뷰 대응 — TSP 순서 불일치, 슬롯 대안 좌표 환각, 폴백 태그 유실, hidden_gem 노출 누락, TourAPI 중복, 임베딩 배치 재사용 수정 (7건) — 2026-07-02
- [x] 네이버 지역검색 API 보강 수집기 — 동네 단위 키워드로 카카오 실패(순증 0건) 반복 방지, 전국 14개 도시 순증 1,180건 (`scripts/collect_naver_local.py`) — 2026-07-05

**[Spring]**
- [x] 폴백 — 유사 루트 추천 — FastAPI 장애 시 DB 유사 루트 조회로 SSE 대체, 없으면 기존 에러 처리 유지 (`trip/service/FallbackRouteService.java`) — 2026-07-04
- [x] Rate Limiting 튜닝 — 사용자당 1분 3회, Redis ZSET 슬라이딩 윈도우, Spring Cloud Gateway 없이 Filter로 구현 (`common/filter/RateLimitFilter.java`) — 2026-07-04

**[공통]**
- [x] 통합 테스트 E2E — 실 서비스(DB/Redis/Claude API) 기반 수동 스크립트, 6개 시나리오 전부 통과 (`ai/scripts/e2e_test.py`) — 2026-07-05

**[Frontend UX + AI 품질 — 중간 점검 후속 (2026-06-30 완료)]**
- [x] 전체보기 라우팅 버그 수정 + 내 루트 목록 화면 (`app/routes/index.tsx`) — 2026-06-30
- [x] 루트 생성 날짜 선택 UI — step-1 출발일 DatePicker — 2026-06-30
- [x] 루트 저장 완료 피드백 토스트 — 2026-06-30
- [x] 루트 결과 화면 일별 예상 비용 합계 표시 — 2026-06-30
- [x] 루트 결과 화면 날씨 정보 표시 (OpenWeatherMap) — 2026-06-30
- [x] 프로필 화면 구현 (닉네임 + 내 루트 목록 연결) — 2026-06-30
- [x] AI 예산 일별 균등 배분 + Day별 장소 지역 집중 프롬프트 개선 — 2026-06-30

**[Frontend UX 후속 — 루트 삭제·날씨 예보·생성 플로우 개선 (2026-07-01 완료)]**
- [x] 루트 삭제 API + 목록 스와이프 삭제 완성 — 2026-07-01
- [x] 루트 생성 Step1 — 날짜 범위 피커로 확장(박수 자동 계산) — 2026-07-01
- [x] 루트 생성 Step3 — 전용 로딩 화면(진행률 표시) — 2026-07-01
- [x] 날씨 정보 표시 5일 예보로 확장 (일자별 날씨) — 2026-07-01
- [x] 루트 상세화면 지도 마커 클릭 → 슬롯 스크롤 연동 — 2026-07-01
- [x] 루트 생성 후 "내 루트" 목록 캐시 미반영 버그 수정 — 2026-07-01

**[Frontend 날씨 표시 개선 (2026-07-02 완료)]**
- [x] Day 카드 날씨를 정오 스냅샷 → 하루 평균 기온으로 변경 + 슬롯별 강수 블록 아이콘 표시 (`lib/api/weather.ts`, `components/route/SlotCard.tsx`) — 2026-07-02

**[루트 생성 품질 개선 — 클러스터링·하루요약·안정성 버그 (2026-07-02 완료)]**
- [x] 날씨 카드 개선 — 총예산 제거, 좌표 기반 조회로 전환(도시명 검색 실패 버그 수정), 설명 매핑 전체 확장, 부분 강수 시간대 힌트 — 2026-07-02
- [x] 동선 최적화 1단계 — 지역 클러스터링 도입 + OR-Tools 개선 탐색 활성화 + 클러스터 크기 균형 제약(34/14/2→25/13/12 개선) — 2026-07-02
- [x] "하루 요약" AI 생성 기능 추가 (AI ndjson 확장, DB V6 마이그레이션, Spring dispatcher, Frontend 연동) — 2026-07-02
- [x] 다일차 루트 생성 안정성 버그 3건 — max_tokens 잘림, route_slots 저장 무효화(AOP self-invocation), 슬롯 중복 배치 — 2026-07-02
- [x] 홈 화면 캐시·진행률 계산·로딩 문구 UX 버그 3건 — 2026-07-02
- [x] 루트 삭제/뒤로가기 플로우 버그 3건 — 확인창 우회 방지, 삭제 후 캐시 무효화, 백그라운드 스트림 네비게이션 하이재킹(엉뚱한 루트 삭제) — 2026-07-02
- [x] 기존 루트 재진입 시 날씨 미표시 버그 수정 (`GET /v1/routes/{routeId}` 신규) — 2026-07-02
- [ ] 동선 거리 최적화 — 클러스터 지리적 타이트함(day별 실제 이동 거리)은 미해결, 내일 후속 작업 예정

**[루트 생성 회귀 수정 + UX 개선 (2026-07-03 완료)]**
- [x] 액세스 토큰 자동 갱신 (401 → refresh → 재시도) — 2026-07-03
- [x] AI 루트 생성 "일정 밀도"(density) 입력 추가 — 2026-07-03
- [x] 슬롯 대안 추천 3개 보장 + 환각 방지 강화(index 기반) — 2026-07-03
- [x] 지역 클러스터 최소 크기 보장 — 2026-07-03
- [x] 날씨 실내/실외 배치 프롬프트 강화 + 슬롯 중복 배치 방지 — 2026-07-03
- [x] 저장하기 → 내 루트 목록 이동, 로딩화면 진행률/문구 동기화, 날씨카드 아이콘·정렬·색상 개선 — 2026-07-03

### 2026-07-03 ~ 2026-07-04: 숙소 입력 + 이동시간 정확도 개선 ✅

> 여행 루트가 날짜별로 위치가 고정되지 않아 일관성이 떨어지는 문제 + 이동시간 미반영 문제 개선. 지도(react-native-maps)는 현행 유지, 구글 플레이스 등 추가 데이터소스는 이번 범위 제외(보류).

> ~~TourAPI 숙박(contentType 32) 수집 후 시드 데이터로 검색~~ — 시도 후 철회(2026-07-03). 실측 결과 지역별 커버리지가 너무 낮음(서울 254 / 부산 79 / 제주 62건, `#숙박` 태그) — 숙소 검색은 카카오 로컬 검색 실시간 호출로만 처리하기로 변경. 관련 코드(`scripts/collect_tourapi.py`)와 테스트 데이터는 롤백함.

**[FastAPI]**
- [x] `RouteGenRequest`에 숙소 좌표 필드 추가 + TSP 시작/종료 앵커로 반영 (`models/schemas.py`, `services/tsp_service.py`, `services/route_service.py`) — 숙소=depot 왕복 TSP, 체크아웃 당일은 매핑 제외, 최적화는 Haversine 유지 — 2026-07-03
- [x] 이동수단별 이동시간 반영 — 자동차/도보는 거리 근사치(Haversine×1.3÷평균속도, 외부 API 불필요), 대중교통만 Tmap 대중교통 API 실호출(`services/transport_service.py` 신규). 카카오모빌리티/네이버/ODsay/구글은 검토 후 배제(도보·대중교통 오픈API 부재 또는 한국 도보길찾기 자체 규제) — 2026-07-04
- [x] 대중교통 노선 + 환승 횟수 요약 표시 (Tmap legs 파싱, `transit_summary` 필드) — 실기기 테스트 피드백 반영 — 2026-07-04
- [x] 여수 실사용 피드백 — 숙소 Day1 클러스터 시딩 + day 슬롯 하드캡 + max_tokens 상향 (환각/중복 재시도로 인한 트렁케이션 방지) — 2026-07-04
- [x] 대중교통 구간별 상세(승하차 정류장) 탭 펼치기 — Tmap 응답 legs에서 구조화 추출, 슬롯 교체 시 이웃 재계산에도 반영 — 2026-07-04

**[Spring]**
- [x] `Accommodation` 엔티티 + 마이그레이션(V7) + 실시간 숙소 검색 프록시 API — 카카오 로컬 검색 실시간 호출(TourAPI 시드 안 씀), route 전용 저장(공유 캐시 아님), 역지오코딩도 카카오 재사용 — 2026-07-03
- [x] 숙소 데이터를 AI 생성 요청에 전달 — Route 생성과 같은 트랜잭션으로 숙소 저장 + `AiServiceClient`가 FastAPI에 `accommodations`/`start_date` 전달, 숙소 있으면 캐시 우회. **이걸로 숙소 입력 → TSP 앵커 반영 end-to-end 완성** — 2026-07-03
- [x] `Route.transportMode` 필드 매핑 + AI 요청에 `transport_mode` 전달 — 2026-07-04
- [x] `RouteSlot`/`RouteSlotService`에 `transport_to_next`/`transport_minutes` 저장 로직 — AI ndjson에 실린 이동시간을 파싱해 저장. **이걸로 이동시간 표시 end-to-end 완성** — 2026-07-04
- [x] 슬롯 "대안 교체" 영속화 + 이웃 이동정보 재계산 — 기존엔 프론트 로컬 캐시만 갱신되고 저장이 안 되던 버그 수정, `AlternativePlace.place_id` 누락도 함께 수정 — 2026-07-04

**[Frontend]**
- [x] 숙소 검색 + 지도 핀 선택(fallback) UI, 루트 생성 폼에 step-4 추가 (여행당 1건 스코프) — 부수로 백엔드 역지오코딩 엔드포인트도 신규 노출(기존에 구현만 되고 미사용) — 2026-07-04
- [x] `TripMap.tsx` 숙소 전용 마커 추가 (day 무관 고정 스타일, zIndex 최상단) — 2026-07-04
- [x] 이동수단 선택 UI (여행 생성 폼, 선택 사항·기본값 없음 — Tmap 할당량 소진 상태 고려) — `SlotCard.tsx`는 `transportToNext`/`transportMinutes` 표시 로직 기존재, 실값만 채워지면 반영됨 — 2026-07-04
- [x] 날씨 예보 범위(5일) 밖 안내 문구 + 과거/여행종료 처리 — 2026-07-04
- [x] 이동수단 칩 UI 오버플로우 수정 + 로딩 화면 아이콘 순환 애니메이션 + 진행률 8% 시작 — 2026-07-04

### 2026-07-09: 상세보기 슬롯 드래그 재정렬 ✅

**[Spring]**
- [x] `PATCH /v1/routes/{routeId}/slots/reorder` — day 내부 슬롯 순서 일괄 변경 + 이동정보 재계산 — 2026-07-09

**[Frontend]**
- [x] `SlotCard.tsx` `DraggableSlotRow` — 카드 실측 높이 기반 드래그 재정렬 — 2026-07-09
- [x] 재정렬 후속 버그 수정 — Reanimated 워클릿 에러(`resolveTargetIndex` non-worklet 호출) + 이동수단 칩 오버플로(TouchableOpacity flexShrink 누락) — 2026-07-09

### 2026-07-09: 사전 고정(pinned) 슬롯 기반 ✅

**[공통]**
- [x] `fixedSlots`(day+place) 계약 신설 — AI 생성 파이프라인에 확정 장소 통합(TSP/이동시간 계산 포함) + Redis 캐시 우회. 공유 루트 가져오기/콘서트 앵커가 공통으로 쓸 기반 — 2026-07-09
- [x] 공유 루트 가져오기 — is_public 토글 + 공개 루트/슬롯 조회 API(소유자 전용 경로와 완전 분리) + 위저드 신규 스텝(import-slots) + save_count 연동 — 2026-07-09

### 2026-07-10: 외부/수동 장소 처리 기반 ✅

**[공통]**
- [x] places.is_curated 플래그 + POST /v1/places/external find-or-create — 콘서트 앵커/유저 직접 장소 추가가 공통으로 쓸 기반, AI 추천 후보에서 완전 분리 — 2026-07-10
- [x] 직접 장소 추가(카카오 검색) — 카테고리 필터 없는 일반 검색 + 위저드 import-slots에 검색 탭 통합, 선택 즉시 find-or-create로 확정 — 2026-07-10

---

## Phase 2: AI 챗봇 + 예산 관리 (~2026-07-25 ~)

### ~2026-07-25 ~ 2026-08-14: AI 챗봇

> **1단계 스코프 축소 (2026-07-05)**: 원래 견적(8~10주) 대비 스코프를 좁혀 여행 중 실시간 어시스턴트 + 읽기전용 도구 3개(`search_nearby_places`/`get_weather_forecast`/`get_route_status`)부터 진행. 스트리밍 없이 non-streaming 단발 응답으로 시작(추후 `route_gen.py` NDJSON 패턴 이식 가능). 예산 추적 기능 자체가 미구현이라 `record_expense`/`get_remaining_budget`는 다음 단계로, `suggest_alternatives`는 기존 Pin&Reshuffle과 중복이라 후순위, 여행 전 대화형 루트 생성도 다음 단계로 미룸.

- [x] `search_nearby_places`/`get_weather_forecast`/`get_route_status` Function Calling 도구 3종 (`ai/app/services/chat_service.py`) — 2026-07-05
- [x] Redis 세션 관리 (메시지 히스토리, TTL 2h) — 2026-07-05
- [x] Spring `ChatController` + `AiServiceClient.chat()` + 소유권 검증(이중) + Rate Limit 분리(분당 10회) — 2026-07-05
- [x] 챗봇 UI 구현 (`(tabs)/chat.tsx` — 메시지 리스트 + 입력창, 스트리밍 없음) — 2026-07-05
- [x] GPS 없이 시간 기반 "현재 위치" 추정 — `route_slots.start_time` 누적 계산으로 확신 높음/낮음 분기, 애매하면 챗봇이 되묻기 (`_estimate_current_slot`) — 2026-07-05
- [x] 추천 장소 → 일정에 바로 삽입 — 챗봇 카드 탭 시 추정 슬롯과 다음 슬롯 사이에 새 슬롯 삽입(`POST /v1/routes/{routeId}/slots`), 이웃 이동정보·start_time 재계산 — 2026-07-05
- [x] `route_slots.start_time` 알고리즘 계산 — 하루 09:00 고정 시작 + duration/transport 누적 역산, LLM이 시간 직접 생성 안 함 (`route_service.py`) — 2026-07-05
- [x] 챗봇 후속 개선 — 이동수단 기본값(car) 적용, get_route_status 날짜 인식 수정, 추천 카드 한줄 이유(Haiku) 추가 — 2026-07-06
- [ ] (다음 단계) LangChain 멀티턴 챗봇 파이프라인 고도화, 챗봇 스트리밍
- [ ] (다음 단계) `record_expense`/`get_remaining_budget` — 예산 추적 기능 선행 필요
- [ ] (다음 단계) `modify_route_slot`/`suggest_alternatives` — Pin&Reshuffle과 통합 검토
- [ ] (다음 단계) 여행 전 대화형 루트 생성
- [ ] (다음 단계) 예산 자연어 파싱, 지출 파싱 확인 팝업 UI

### ~2026-08-04 ~ 2026-08-25: 예산 관리 & 지출 추적

> **스코프 결정 (2026-07-06)**: DB 조사 결과 `budget_settings`/`expenses` 테이블은 이미 있지만(V4 마이그레이션) 코드 사용처가 0건 — 실질 미구현 상태에서 시작. 두 가지를 결정: **① 숙박 제외** — `accommodations` 테이블에 비용 필드 자체가 없고(이름/주소/체크인아웃만) 숙소는 AI 추천이 아니라 사용자가 직접 핀 찍는 구조라 자동화 지점이 없음. 이번 단계의 "총예산"은 **숙박비 제외 현지 활동/식사 예산**으로 스코프 한정, 안내 문구 필요. **② 카테고리 자동 배분은 이미 고른 태그 재활용(새 질문 추가 안 함)** — step-3에서 이미 고르는 장소 성향 태그(#먹방/#카페/#액티비티 등)로 식음료/교통/입장료/기타 4개 카테고리 비율을 소폭 조정, 별도 "예산 우선순위" 질문은 기존 태그 선택과 중복돼 안 만듦. **③ 계획 지출(자동 생성 슬롯)은 카테고리 구분 없이 총액으로만 추적** — 슬롯의 `estimated_cost`가 식사/입장료/액티비티 뭉뚱그려 하나의 숫자라 정확한 카테고리 분류 불가(실측: 55,000원짜리 워터파크·5,000원짜리 미술관 다 구분 없이 섞여있음). 카테고리별 정확한 집계는 사용자가 직접 입력하는 "비계획 지출"에서만.

- [x] 총예산 입력 (루트 생성 흐름 step-3 근처에 통합, 숙박비 제외 안내 문구) — 2026-07-06
- [x] 카테고리 4개(식음료/교통/입장료/기타)로 목표 배분 — 기존 DB 비율에서 숙박 제외 후 재정규화 — 2026-07-06
- [x] 이미 선택된 장소 성향 태그로 비율 자동 조정 (맛집·카페 → 식음료↑, 액티비티 → 입장료↑, 소폭 ±5~10%p) — 2026-07-06
- [x] 슬라이더로 배분 비율 직접 조정 UI — 2026-07-06
- [x] 계획 지출 = 루트 슬롯 `estimated_cost` 총합 자동 집계(카테고리 구분 없음) — 2026-07-06
- [x] 비계획 지출 + 버튼 입력 폼 — 식음료/교통/입장료/기념품/기타 카테고리 사용자가 직접 선택(유일하게 카테고리별 정확 데이터가 쌓이는 지점) — 2026-07-06
- [x] 잔여 예산 배너 — 총액 기준만(카테고리별 잔여는 계획지출 미분류로 이번 단계 제외) — 2026-07-06
- [x] 여행 후 지출 리포트 — 계획지출은 "현지 활동비" 하나로, 비계획지출만 카테고리별 차트(victory-native, `@shopify/react-native-skia` 신규 설치) — 2026-07-06
- [ ] 예산 초과 시 챗봇 저가 대안 자동 제안 — 별도 태스크로 분리(기존 챗봇 인프라 변경 영향범위가 커서 이번 스코프에서 제외)
- [ ] (다음 단계) 숙박비 반영 — 예약 기능으로 실제 숙박 비용 데이터 확보되면 카테고리 재도입
- [ ] (다음 단계) 계획 지출 카테고리 자동 분류 고도화 — `category_tags` → expense category 매핑 정확도 개선

### Hidden Gems + 태그 커뮤니티 (자금 확보 후 — 연기)

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

## Phase 2.5: 타겟 전환 — 방한 외국인 관광객 대응 (2026-07-06 ~)

> **타겟 전환 결정 (2026-07-06)**: 한국인 국내여행자 → 한국을 방문하는 외국인 관광객으로 전환. 기존 `planning/strategy.md`의 "해외 피벗"은 전부 **한국인이 해외로 나가는(아웃바운드)** 시나리오였는데, 이번 전환은 **외국인이 한국에 오는(인바운드)**이라 정반대 방향 — 기존 로드맵의 연장이 아니라 새 방향. 전체 코드베이스 조사 결과, 프론트 27개 파일 422줄 한국어 하드코딩(i18n 인프라 전무), 챗봇 시스템 프롬프트 4곳이 "한국어로 답변" 강제, `places` 테이블에 영문 컬럼 자체가 없음, `expenses.category` 등 한글이 코드값으로 박혀있는 부분까지 확인됨.
>
> **1단계 스코프(완료)**: i18n 인프라(i18next, 한/영/일/중 4개 언어, 기기 로케일 자동감지+수동 설정) 구축 + 챗봇 화면 마이그레이션 + AI 챗봇이 사용자 메시지 언어로 답변하도록 시스템 프롬프트 수정.
>
> **⚠️ Phase 3 재검토 필요**: 아래 "결제 + 인증 완성" 섹션의 토스페이먼츠(국내 전용 PG)와 카카오 로그인(국내 전용 서비스)은 외국인 관광객 타겟과 맞지 않음 — 국제결제(Stripe 등)와 구글/애플 로그인 우선순위 재조정 필요(별도 논의 필요, 이번엔 코드 변경 안 함).

- [x] i18n 인프라 구축(i18next + react-i18next + expo-localization, 한/영/일/중 4개 언어, MMKV 저장) — 2026-07-06
- [x] 챗봇 화면(`chat.tsx`) 다국어 마이그레이션 + 프로필 화면 언어 설정 UI — 2026-07-06
- [x] AI 챗봇 응답 다국어 대응(사용자 메시지 언어로 답변, 시스템 프롬프트 수정) — 2026-07-06
- [ ] (다음 단계) 루트 생성 프롬프트(`route_service.py`) 다국어화
- [ ] (다음 단계) 나머지 화면(로그인/온보딩/루트 생성 스텝 등) i18n 마이그레이션
- [ ] (다음 단계) 장소 데이터(`places.name`/`address`) 영문화 — 번역 방식(배치/실시간/영문 데이터소스 추가) 논의 필요
- [ ] (다음 단계) 한글 하드코딩된 코드값 리팩터링 — `expenses.category` 등을 언어중립 코드로 변경
- [ ] (다음 단계) 국제결제(Stripe 등) 연동 검토
- [ ] (다음 단계) Hidden Gems 기능 전제 재검토 — "현지인이 등록"하는 컨셉인데 유저가 외국인 관광객이 되면 등록 주체가 누구인지 재정의 필요

---

## Phase 2.6: 타겟 전환 실행 로드맵 (2026-07-07 ~)

> 위 Phase 2.5 "다음 단계" 목록을 실제 구현 순서(Phase 1~4, 11개 항목)로 구체화. docs/planning/README 반영(PR #88)을 마친 뒤 확정. 노션 플래너(`Cloumy플래너`)에 Phase별 부모 페이지 4개 + 항목별 자식 페이지 11개로 동일하게 등록함 — 각 항목 상세 배경·스코프는 해당 노션 페이지 참고.

### Phase 1 — 사용성 최우선 (지금 상태로는 외국인이 못 씀)
- [x] 나머지 화면 i18n 마이그레이션 (로그인/홈/루트생성 Step1~4/루트결과/예산/프로필/목록) — 온보딩은 화면 자체가 아직 없어 제외(Phase 3 태그 재설계 때 신규 생성 예정) — 2026-07-07
- [x] 하드코딩된 한글 코드값 리팩터링 (`expenses.category` 등 언어중립 코드로 변경) — 2026-07-07
- [x] 루트 생성 프롬프트 다국어화 (`route_service.py`의 `ROUTE_GEN_SYSTEM_PROMPT`, 챗봇과 동일 패턴 재사용) — 2026-07-07

### Phase 2 — 빠른 개선 (기존 데이터·백엔드 재사용, 저비용 고효율)
- [x] 이동수단 자동 판단(거리 기반)으로 전환 — 이동수단 선택 질문(선택 사항이라 건너뛰면 전 구간 정보 누락) 삭제, `enrich_transport()`가 슬롯 간 거리(1km 기준)로 walk/transit 자동 판단. 슬롯 교체 시 `DEFAULT_TRANSPORT_MODE="car"` 하드코딩 불일치 버그도 함께 해소 — 지도 내비 분기(walk/transit 2-way) 기능이 실제로 모든 루트에서 동작하기 위한 선행 조건 — 2026-07-08
- [x] 지도 내비 분기 (walk=Google/transit=Naver 2-way 우선 구현, `transportToNext` 필드 재사용 — 카카오T는 외국인 타겟과 안 맞아 제외, 우버 딥링크는 현지 이용 가능성 확인 후 별도 판단 예정) — 2026-07-08
- [x] 로그인 화면 우선순위 조정 (구글만 노출, 애플은 개발자 계정 미보유로 제외, 카카오는 국내 전용이라 이번엔 완전히 제거 — 백엔드 변경 불필요) — 2026-07-08
- [x] 대중교통 내비 출발지에 실제 GPS 위치 사용 (`expo-location` 신규 도입 — 지도 내비 분기 실사용 중 발견된 후속 개선, 이슈 #106) — 2026-07-08

### Phase 3 — 신규 핵심 기능 (각자 별도 브레인스토밍 필요, 권장 순서)
- [ ] 취향 태그 시스템 재설계 (10종) — 온보딩·Discovery 기반이라 먼저
- [ ] 콘서트·이벤트 앵커 (Serper+KOPIS) — 기존 숙소 앵커(TSP depot) 패턴 재사용으로 상대적으로 수월
- [ ] Foreigner Friendly Score — 스키마 설계 + 데이터 입력(개발과 별도 트랙 병행 가능)
- [ ] 카메라 챗봇 (메뉴판·키오스크·간판 번역) — Vision API 신규 통합, 난이도 최고로 마지막

### Phase 4 — 코드보다 의사결정이 먼저 (지금부터 논의 시작 가능)
- [ ] 장소 데이터 영문화 방식 결정 (배치 LLM 번역 vs 실시간 vs 영문 데이터소스)
- [ ] 국제결제 PG 선택 (Stripe 등, 계약·키 발급 선행 — 급하지 않음)

---

## Phase 3: 결제 + 그룹 모드 + 출시 준비 (~2026-09-01 ~)

### ~2026-09-01 ~ 2026-09-15: 결제 + 인증 완성

- [ ] ⚠️ 토스페이먼츠 웹뷰 결제 구현 — **재검토 필요**: 국내 전용 PG라 외국인 카드 결제 미지원. Stripe 등 국제결제 PG로 대체 검토 (`planning/strategy.md`, `planning/priorities.md` 참고)
- [ ] 서버 사이드 결제 검증 API (선택된 PG 기준으로 재설계)
- [ ] 트립 패스 활성화 로직 (`pass_type`을 `standard`/`extended`로 변경, `pass_expires_at`)
- [ ] 환불 처리 (여행 start_date 기준 자동 판단)
- [ ] PassGate UI (트립 패스 필요 기능 게이트)
- [ ] ⚠️ 소셜 로그인 완성 — **우선순위 조정 필요**: 구글·애플 우선, 카카오는 국내 전용 서비스라 외국인 타겟과 안 맞아 보류
- [ ] 인증 플로우 완성 (JWT, Refresh Token)

### ~2026-09-15 ~ 2026-10-06: 그룹 여행 모드 + 오프라인 저장 + 출시

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

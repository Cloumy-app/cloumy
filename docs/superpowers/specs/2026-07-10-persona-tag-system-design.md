# 취향 태그 시스템 재설계 (10종 페르소나) 설계

## 배경

현재 장소 취향 관련 태그는 두 종류가 혼재돼 있다.

- `places.category_tags`: 한국어 해시태그(#관광, #야경 등), 장소 자체의 속성. AI 루트 생성의 `PostgisTagRetriever`가 검색 필터로 사용.
- `frontend/app/route/create/step-2.tsx`의 `THEMES`: 맛집/카페/관광/자연/쇼핑/문화/액티비티/힐링/야경 9종 한국어 테마 태그. 루트 생성 시 유저가 매번 선택하는 "이번 여행 의도" — `routes.tags TEXT[]`(`V3__create_routes.sql`)에 루트별로 저장됨.

Notion 기획서(`docs/01-prd.md` Feature 4, "여행자 취향 태그 시스템 재설계")는 이와 별개로 K-pop Pilgrim/K-drama Fan/K-food Lover/K-beauty Addict/Culture Explorer/Nature Seeker/Shopping Maven/Content Creator/Night Owl/Cafe Hopper **10종 영어 페르소나 태그**를 온보딩 스와이프 UI로 부여하고, 온보딩·프로필·Discovery·루트생성 전반의 태그 체계로 쓰자고 제안한다. 온보딩 화면(`app/(auth)/onboarding.tsx`) 자체는 현재 존재하지 않는다.

`planning/milestones.md` Phase 2.6 로드맵의 Phase 3 항목 — 취향 태그 재설계가 온보딩·Discovery의 기반이라 다른 Phase 3 항목(카메라 챗봇, 콘서트 앵커, Foreigner Friendly Score)보다 먼저 진행한다.

## 핵심 설계 결정

**페르소나 태그(10종, 유저 정체성)와 테마 태그(9종, 이번 여행 의도)는 별개 개념으로 유지한다.** 예: K-pop 팬 페르소나를 가진 유저가 어느 날 전통문화 여행을 떠날 수 있다 — 페르소나가 테마 선택을 강제하거나 제약해서는 안 된다.

대신 페르소나는 테마 선택의 **기본값 제안**으로만 약하게 연결한다:
- route 생성 step-2 진입 시 유저의 페르소나 태그에 매핑된 테마를 pre-select 상태로 미리 체크해두되, 유저는 언제든 자유롭게 해제·재선택 가능(강제 아님)
- Discovery 피드도 페르소나 태그로 기본 필터링하되, 유저가 끌 수 있는 토글 제공

10종 페르소나 중 6종(K-food Lover/Cafe Hopper/Nature Seeker/Shopping Maven/Culture Explorer/Night Owl)만 9종 테마와 자연스럽게 매핑되고, 나머지 4종(K-pop Pilgrim/K-drama Fan/K-beauty Addict/Content Creator)은 매핑 대상이 아니다 — 온보딩 스와이프와 프로필 수동 편집으로만 관리된다.

페르소나 태그는 온보딩에서 최초 부여된 뒤에도 **프로필에서 자유롭게 추가/삭제** 가능하고(1회성 고정 아님), **루트 생성 이력(`routes.tags`) 누적을 기반으로 자동 추가**도 된다 — 예: "맛집" 테마가 들어간 루트를 3개 이상 만들면 K-food Lover 페르소나가 자동으로 프로필에 추가된다. 이 자동 추가는 매핑이 있는 6종 페르소나에만 적용된다.

이 자동 추가는 `planning/priorities.md` P2의 "행동 기반 태그 자동 보정"(이벤트 로그 3개월 이상 축적 필요, 별도 항목)과는 다르다 — `routes.tags`는 이미 매 루트 생성 시 저장되는 기존 데이터라 이벤트 로깅 인프라 없이 바로 구현 가능한 훨씬 가벼운 신호다. 우연히 이름이 비슷한 별개 기능이니 혼동하지 않는다.

## 범위

**포함**:
- `users.persona_tags TEXT[]` 스키마 추가 + GIN 인덱스
- 페르소나(10종) ↔ 테마(9종) 매핑 코드 상수 (6종만 매핑 존재)
- 온보딩 스와이프 UI(이미지 카드 8장, 신규 화면) + 최초 페르소나 태그 세팅 API
- 프로필에서 페르소나 태그 추가/삭제 UI + 전체 교체 API
- 루트 생성 완료 시 `routes.tags` 누적 카운트 기반 자동 추가 로직 (임계값 3, 매핑 있는 6종 한정)
- route step-2 진입 시 페르소나 → 테마 역매핑 pre-select
- Discovery 피드(`explore.tsx`) 페르소나 태그 기반 필터 (끌 수 있는 토글 포함)

**제외**:
- `planning/priorities.md` P2의 이벤트 로그 기반 행동 태그 자동 보정 — 별도 항목, 이번 스코프 아님
- 매핑 없는 4종 페르소나에 대한 자동 추가/pre-select — 온보딩·수동 편집으로만 관리
- 페르소나 태그 부여 출처(온보딩/자동/수동) 메타데이터 저장 — 지금은 불필요, 필요해지면 컬럼 추가

## 데이터 모델

**`V15__add_users_persona_tags.sql`**
```sql
ALTER TABLE users ADD COLUMN persona_tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_users_persona_tags ON users USING GIN (persona_tags);
```

**`V16__add_routes_tags_gin_index.sql`** (자동 추가 로직의 오버랩 쿼리 성능용, `routes.tags`는 이미 존재하는 컬럼)
```sql
CREATE INDEX idx_routes_tags ON routes USING GIN (tags);
```

**페르소나 상수** (백엔드 enum 또는 상수 클래스, `PersonaTag`):
```
K_POP_PILGRIM, K_DRAMA_FAN, K_FOOD_LOVER, K_BEAUTY_ADDICT,
CULTURE_EXPLORER, NATURE_SEEKER, SHOPPING_MAVEN,
CONTENT_CREATOR, NIGHT_OWL, CAFE_HOPPER
```

**페르소나 ↔ 테마 매핑**

| 페르소나 | 테마 태그 | 자동추가/pre-select 대상 |
|---|---|---|
| K-food Lover | 맛집 | O |
| Cafe Hopper | 카페 | O |
| Nature Seeker | 자연 | O |
| Shopping Maven | 쇼핑 | O |
| Culture Explorer | 문화, 관광 | O |
| Night Owl | 야경 | O |
| K-pop Pilgrim | — | X (온보딩·수동만) |
| K-drama Fan | — | X (온보딩·수동만) |
| K-beauty Addict | — | X (온보딩·수동만) |
| Content Creator | — | X (온보딩·수동만) |

## 핵심 변경 흐름

**1. 온보딩** (`frontend/app/(auth)/onboarding.tsx`, 신규)
- 최초 로그인 유저만 진입(재로그인 유저는 스킵), 이미지 카드 8장을 좌우 스와이프
- 카드마다 1~2개 연관 페르소나 태그가 매핑돼 있음 — 완료 시 "좋아요"한 카드들의 페르소나를 집계해 상위 2~3개 확정
- `react-native-gesture-handler`의 `Gesture.Pan()` + `react-native-reanimated` v4 사용 (`frontend/CLAUDE.md` 컨벤션 — `useAnimatedGestureHandler` 미지원 룰 준수)
- 완료 시 `POST /v1/users/me/persona-tags` — `{ tags: string[] }` (최초 세팅)
- 스킵 시 `persona_tags = []`로 시작, 이후 프로필에서 수동 추가 가능

**2. 프로필 수정**
- 기존 프로필 화면에 "내 여행 취향" 섹션 — 보유 태그 칩(X로 제거) + "추가" 바텀시트(10종 중 미보유 태그 선택)
- `PATCH /v1/users/me/persona-tags` — `{ tags: string[] }` (전체 교체)

**3. 자동 추가** (`RouteService.java`, `routeRepository.save(route)` 직후)
- 저장된 유저의 기존 루트에서 `tags && ARRAY['맛집']` 등 매핑된 테마 오버랩 카운트 조회
- 3개 이상 & 아직 미보유 페르소나면 `persona_tags`에 추가 (조용히, 알림 없음)
- 동시성: 유저가 짧은 시간에 여러 루트를 동시 생성하는 케이스는 실질적으로 없어 별도 락 불필요

**4. route step-2 pre-select** (`step-2.tsx`)
- 진입 시 `GET /v1/users/me` 응답의 `personaTags` 필드를 페르소나→테마 역매핑해 `defaultValues.tags`로 미리 체크
- 유저가 그 자리에서 자유롭게 변경 가능

**5. Discovery 필터** (`explore.tsx`)
- 유저 `persona_tags`를 매핑된 테마로 변환해 `places.category_tags && (...)` 오버랩으로 후보 조회
- 전체 피드 보기로 끌 수 있는 토글 제공

## 에러 처리 & 엣지 케이스

- 온보딩 API 실패: 로컬 재시도 유도, 실패해도 앱 진입 차단 안 함 (`persona_tags = []`로 스킵과 동일 취급)
- 매핑 없는 4종만 보유한 유저: route 자동추가/pre-select 대상에 그냥 기여 안 함 — 프로필 표시만 정상 동작
- 페르소나 태그 전체 삭제: Discovery는 무필터(전체 노출) 폴백, step-2는 pre-select 없이 빈 상태 시작 — 기존 동작과 동일
- `routes.tags` GIN 인덱스 추가는 기존 데이터량이 적어(routes 테이블) 마이그레이션 리스크 낮음

## 테스트 전략

- Backend: `RouteServiceTest` — 동일 테마 3회 도달 시 추가 / 임계값 미달 시 미추가 / 이미 보유 시 중복 추가 안 함
- Backend: `UserController` 온보딩(최초 세팅)·프로필(전체 교체) API 통합 테스트
- Frontend: 온보딩 스와이프 제스처는 자동화 테스트 대상 아님(기존 프로젝트 관행) — Expo 빌드로 실기기/시뮬레이터 수동 확인
- E2E 수동 시나리오: 신규 가입 → 온보딩 → 프로필 확인 → 동일 테마 루트 3회 생성 → persona_tags 자동 추가 확인

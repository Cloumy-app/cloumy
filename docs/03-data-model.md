# 데이터 모델

## ERD (핵심 엔티티)

```
users
  ├── routes (1:N) — 사용자의 여행 루트
  │     ├── route_slots (1:N) — 루트의 일정 슬롯
  │     └── expenses (1:N) — 루트의 지출 내역
  ├── payments (1:N) — 트립 패스 결제
  ├── bookmarks (1:N) — 사용자가 저장한 장소
  └── user_levels (1:1) — Hidden Gems 레벨

places
  ├── route_slots (N:M) — 슬롯에 배치된 장소
  ├── bookmarks (1:N) — 장소를 저장한 북마크
  └── hidden_gems (1:1, 선택) — Hidden Gem으로 등록된 장소

group_trips
  ├── group_members (1:N) — 그룹 참여자
  └── routes (1:1) — 그룹의 공유 루트
```

## 엔티티 정의

### users

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| oauth_provider | VARCHAR | ✅ | 'google' \| 'apple' \| 'kakao'(보류, 국내 전용이라 외국인 타겟과 안 맞음 — 재검토 필요) |
| oauth_id | VARCHAR | ✅ | 소셜 로그인 식별자 |
| nickname | VARCHAR | ✅ | 표시 이름 |
| profile_image_url | VARCHAR | - | 프로필 이미지 |
| pass_type | VARCHAR | - | 'none' \| 'standard' \| 'extended' — ⚠️ 2026-07-06 타겟 전환으로 `domestic_*`/`overseas_*` 구분에서 변경(결제 미구현이라 실제 마이그레이션은 결제 기능 구현 시점에 반영) |
| pass_expires_at | TIMESTAMP | - | 트립 패스 만료 시각 |
| is_beta_tester | BOOLEAN | ✅ | 베타 테스터 여부 (레전드 배지) |
| created_at | TIMESTAMP | ✅ | |

### places

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| name | VARCHAR | ✅ | 장소명 (⚠️ 한국어만 존재, 영문 컬럼 없음 — 외국인 타겟 전환 후 영문화 방식 논의 필요, `planning/priorities.md` P2 참고) |
| location | GEOGRAPHY(POINT) | ✅ | PostGIS 좌표 |
| address | VARCHAR | - | 도로명 주소 (영문 컬럼 없음, 위와 동일) |
| category_tags | TEXT[] | ✅ | ['먹방', '한식', '전통시장'] — ⚠️ 여행자 취향 태그 시스템은 이 필드와 별개로 Notion 10종 영어 태그(K-pop Pilgrim 등)로 재설계 계획, `docs/01-prd.md` 참고 |
| source | VARCHAR | ✅ | 'tourapi' \| 'kakao' \| 'hidden_gem' |
| rarity_score | FLOAT | - | 희소성 점수 0~100 |
| review_count | INTEGER | - | 카카오 플레이스 리뷰 수 |
| is_hidden_gem | BOOLEAN | ✅ | Hidden Gem 배지 여부 |
| is_active | BOOLEAN | ✅ | 활성 여부 (폐업 처리용, 기본값 true) |
| avg_duration_minutes | INTEGER | - | 평균 체류 시간 (분) |
| business_hours | JSONB | - | 요일별 영업시간 |
| time_tags | TEXT[] | - | 시간 속성 태그 ['야간가능', '오전전용'] |
| cost_tags | TEXT[] | - | 비용 속성 태그 ['1만원이하', '3~5만원'] |
| companion_tags | TEXT[] | - | 동행 태그 ['2인추천', '단체가능'] |
| access_tags | TEXT[] | - | 접근성 태그 ['주차가능', '대중교통접근'] |
| trend_score | FLOAT | - | 트렌딩 가중치 (SNS/유튜브 기반, Phase 2) |
| trend_updated_at | TIMESTAMP | - | 마지막 트렌드 갱신 시각 |
| trend_source | TEXT[] | - | 트렌드 출처 ['naver_blog', 'youtube'] |
| embedding | vector(1536) | - | pgvector 임베딩 |
| created_at | TIMESTAMP | ✅ | |

> 📌 **계획 — Foreigner Friendly Score 컬럼 (미구현)**: `friendly_score_english_menu`/`friendly_score_card_payment`/`friendly_score_english_kiosk`/`spice_level`/`dietary_tags` 등 5개 항목 추가 예정. 아직 스키마 설계 전이며 컬럼명은 가안. `docs/01-prd.md` P1 섹션 참고.

### routes

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| user_id | UUID | ✅ | FK → users |
| group_trip_id | UUID | - | FK → group_trips (그룹 모드, Phase 2) |
| title | VARCHAR | ✅ | 여행 제목 |
| destination | VARCHAR | ✅ | 목적지 |
| start_date | DATE | ✅ | 출발일 |
| end_date | DATE | ✅ | 귀환일 |
| nights | INTEGER | ✅ | 박 수 |
| participant_count | INTEGER | - | 인원 수 (선택, 미래 N빵/초대 기능 대비) |
| group_type | VARCHAR | ✅ | 'solo' \| 'couple' \| 'friends' \| 'family' |
| budget_level | VARCHAR | ✅ | 'budget' \| 'mid' \| 'premium' (AI 장소 필터링용) |
| total_budget | INTEGER | - | 총 예산 (원, 예산 관리 기능용) |
| tags | TEXT[] | - | 여행 스타일 태그 |
| density | VARCHAR | - | 'relaxed' \| 'normal' \| 'packed' |
| transport_mode | VARCHAR | - | 'transit' \| 'car' \| 'walk' |
| accommodation_area | VARCHAR | - | 숙소 위치 (동선 최적화 기준점) |
| is_public | BOOLEAN | ✅ | 커뮤니티 공유 여부 |
| save_count | INTEGER | ✅ | 저장 수 (기본값 0) |
| created_at | TIMESTAMPTZ | ✅ | |
| updated_at | TIMESTAMPTZ | ✅ | fn_set_updated_at() 트리거 자동 갱신 |

### route_slots

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes |
| place_id | UUID | ✅ | FK → places |
| day_number | INTEGER | ✅ | 1일차, 2일차... |
| order_index | INTEGER | ✅ | 해당 날의 방문 순서 |
| start_time | TIME | - | 예상 방문 시각 |
| duration_minutes | INTEGER | - | 예상 체류 시간 |
| estimated_cost | INTEGER | - | 예상 비용 (원) |
| is_pinned | BOOLEAN | ✅ | Pin & Reshuffle 고정 여부 (기본값 false) |
| transport_to_next | VARCHAR | - | 'walk' \| 'transit' \| 'taxi' |
| transport_minutes | INTEGER | - | 다음 장소까지 이동 시간 |
| transit_summary | TEXT | - | 대중교통 노선+환승 요약 (예: "버스 143 → 지하철 2호선 (환승 1회)"), transit 모드일 때만 |
| tips | TEXT | - | AI 생성 팁 |

### expenses

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes |
| slot_id | UUID | - | FK → route_slots (NULL이면 비계획 지출) |
| user_id | UUID | ✅ | FK → users |
| expense_type | VARCHAR | ✅ | 'planned' \| 'unplanned' |
| category | VARCHAR | ✅ | '숙박' \| '식음료' \| '교통' \| '입장료' \| '기념품' \| '기타' |
| planned_amount | INTEGER | - | 계획 금액 |
| actual_amount | INTEGER | ✅ | 실제 지출 금액 |
| memo | TEXT | - | 메모 |
| created_at | TIMESTAMP | ✅ | |

### budget_settings

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes |
| total_budget | INTEGER | ✅ | 총 예산 |
| accommodation_ratio | FLOAT | ✅ | 숙박 비율 (기본 0.35) |
| food_ratio | FLOAT | ✅ | 식음료 비율 (기본 0.30) |
| transport_ratio | FLOAT | ✅ | 교통 비율 (기본 0.20) |
| activity_ratio | FLOAT | ✅ | 입장료 비율 (기본 0.10) |
| etc_ratio | FLOAT | ✅ | 기타 비율 (기본 0.05) |

### bookmarks

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| user_id | UUID | ✅ | FK → users |
| place_id | UUID | ✅ | FK → places |
| created_at | TIMESTAMP | ✅ | |

> **UNIQUE (user_id, place_id)** — 동일 장소 중복 북마크 방지

**장소 피드 API** (Spring 구현은 별도 태스크):
```
GET    /v1/places?destination=부산&category=맛집  — 목적지별 장소 피드
GET    /v1/places/{id}                            — 장소 상세 (이름·주소·영업시간·위치·카테고리)
POST   /v1/places/{id}/bookmark                  — 북마크 추가
DELETE /v1/places/{id}/bookmark                  — 북마크 해제
GET    /v1/users/me/bookmarks                    — 내 북마크 목록
```

**초기 데이터 전략**: TourAPI seed (5개 도시) 완료 후 피드 활성화. seed 전에는 루트 생성 Step 3에서 카카오 실시간 검색으로 anchor 선택 → places 테이블 자동 upsert.

---

### hidden_gems

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| place_id | UUID | ✅ | FK → places |
| registered_by | UUID | ✅ | FK → users |
| photo_url | VARCHAR | ✅ | 등록 사진 |
| gps_verified | BOOLEAN | ✅ | GPS 방문 인증 완료 여부 |
| verified_at | TIMESTAMP | - | 인증 시각 |
| route_inclusion_count | INTEGER | ✅ | 루트 반영 횟수 (기본값 0) |
| created_at | TIMESTAMP | ✅ | |

### payments

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| user_id | UUID | ✅ | FK → users |
| pass_type | VARCHAR | ✅ | 'standard'($4.99) \| 'extended'($7.99) — Standard/Extended 가격 확정, `planning/strategy.md` 참고 |
| amount | INTEGER | ✅ | 결제 금액 (통화 단위는 PG 확정 후 결정, 현재 USD 가정) |
| payment_key | VARCHAR | ✅ | 결제 PG 거래 키 — ⚠️ PG 미확정(토스페이먼츠는 국내 전용이라 재검토 필요, Stripe 등 검토 중) |
| status | VARCHAR | ✅ | 'pending' \| 'success' \| 'fail' |
| pass_expires_at | TIMESTAMP | - | 패스 만료 시각 |
| created_at | TIMESTAMP | ✅ | |

### group_trips

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| host_user_id | UUID | ✅ | FK → users (방장) |
| invite_code | VARCHAR | ✅ | 초대 링크/QR 코드 |
| route_id | UUID | ✅ | FK → routes |
| created_at | TIMESTAMP | ✅ | |

### group_members

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| group_trip_id | UUID | ✅ | FK → group_trips |
| user_id | UUID | ✅ | FK → users |
| role | VARCHAR | ✅ | 'host' \| 'member' |
| joined_at | TIMESTAMP | ✅ | |

## 인덱스 전략

```sql
-- 위치 기반 검색 (PostGIS, ST_DWithin 단위 = 미터)
CREATE INDEX idx_places_location ON places USING GIST(location);

-- 태그 필터 검색 (@> 연산자, GIN)
CREATE INDEX idx_places_category_tags  ON places USING GIN(category_tags);
CREATE INDEX idx_places_time_tags      ON places USING GIN(time_tags);
CREATE INDEX idx_places_cost_tags      ON places USING GIN(cost_tags);
CREATE INDEX idx_places_companion_tags ON places USING GIN(companion_tags);
CREATE INDEX idx_places_access_tags    ON places USING GIN(access_tags);

-- Hidden Gems 희소성 정렬 (부분 인덱스)
CREATE INDEX idx_places_rarity ON places(rarity_score DESC) WHERE is_hidden_gem = true;

-- 트렌딩 정렬 (활성 장소만, 부분 인덱스)
CREATE INDEX idx_places_trend ON places(trend_score DESC NULLS LAST) WHERE is_active = true;

-- pgvector 코사인 유사도 검색 (시드 데이터 적재 후 생성, lists=100 기준 26만건)
CREATE INDEX idx_places_embedding ON places USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 루트 조회
CREATE INDEX idx_routes_user   ON routes(user_id, created_at DESC);
CREATE INDEX idx_routes_public ON routes(created_at DESC) WHERE is_public = true;

-- 루트 슬롯 조회 (day별 정렬)
CREATE INDEX idx_route_slots_route ON route_slots(route_id, day_number, order_index);
CREATE INDEX idx_route_slots_place ON route_slots(place_id);

-- 북마크 조회
CREATE INDEX idx_bookmarks_user  ON bookmarks(user_id, created_at DESC);
CREATE INDEX idx_bookmarks_place ON bookmarks(place_id);

-- 지출 조회
CREATE INDEX idx_expenses_route ON expenses(route_id, created_at DESC);
CREATE INDEX idx_expenses_user  ON expenses(user_id, created_at DESC);

-- 결제 상태
CREATE INDEX idx_payments_user_status ON payments(user_id, status);
```

## TypeScript 타입 정의 (프론트엔드 핵심)

```typescript
// 장소
interface Place {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  address?: string;
  categoryTags: string[];
  timeTags: string[];
  costTags: string[];
  companionTags: string[];
  accessTags: string[];
  source: 'tourapi' | 'kakao' | 'hidden_gem';
  avgDurationMinutes?: number;
  businessHours?: Record<string, string>;
  reviewCount?: number;
  isActive: boolean;
  isHiddenGem: boolean;
  rarityScore?: number;
  trendScore?: number;
  trendUpdatedAt?: string;
  trendSource: string[];
  createdAt: string;
}

// 루트 슬롯
interface RouteSlot {
  id: string;
  place: Place;
  dayNumber: number;
  orderIndex: number;
  startTime?: string; // "HH:mm"
  durationMinutes?: number;
  estimatedCost?: number;
  isPinned: boolean;
  transportToNext?: 'walk' | 'transit' | 'taxi';
  transportMinutes?: number;
  transitSummary?: string; // 대중교통 노선+환승 요약, transit 모드일 때만
  tips?: string;
}

// 루트
interface Route {
  id: string;
  title: string;
  destination: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  nights: number;
  participantCount?: number; // 미래 N빵/초대 기능 대비, 입력 폼에서는 수집 안 함
  groupType: 'solo' | 'couple' | 'friends' | 'family';
  budgetLevel: 'budget' | 'mid' | 'premium';
  totalBudget?: number; // 예산 관리 기능용 (원)
  tags: string[];
  density: 'relaxed' | 'normal' | 'packed';
  transportMode?: 'transit' | 'car' | 'walk';
  accommodationArea?: string;
  days: { dayNumber: number; slots: RouteSlot[] }[];
  isPublic: boolean;
  saveCount: number;
}

// 지출
interface Expense {
  id: string;
  routeId: string;
  slotId?: string;
  expenseType: 'planned' | 'unplanned';
  category: '숙박' | '식음료' | '교통' | '입장료' | '기념품' | '기타'; // ⚠️ 한글 하드코딩 — 언어중립 코드값(예: FOOD/TRANSPORT)으로 리팩터링 예정, `planning/milestones.md` Phase 2.5 "다음 단계" 참고
  plannedAmount?: number;
  actualAmount: number;
  memo?: string;
  createdAt: string;
}

// 트립 패스 (Standard $4.99 / Extended $7.99, 2026-07-06 타겟 전환으로 domestic/overseas 구분 폐기)
type PassType = 'none' | 'standard' | 'extended';

// 챗봇 메시지
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: {
    expenseParsed?: Partial<Expense>;
    placeSuggestions?: Place[];
  };
}
```

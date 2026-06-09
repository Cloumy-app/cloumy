# 데이터 모델

## ERD (핵심 엔티티)

```
users
  ├── routes (1:N) — 사용자의 여행 루트
  │     ├── route_slots (1:N) — 루트의 일정 슬롯
  │     └── expenses (1:N) — 루트의 지출 내역
  ├── payments (1:N) — 트립 패스 결제
  └── user_levels (1:1) — Hidden Gems 레벨

places
  ├── route_slots (N:M) — 슬롯에 배치된 장소
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
| oauth_provider | VARCHAR | ✅ | 'kakao' \| 'google' \| 'apple' |
| oauth_id | VARCHAR | ✅ | 소셜 로그인 식별자 |
| nickname | VARCHAR | ✅ | 표시 이름 |
| profile_image_url | VARCHAR | - | 프로필 이미지 |
| pass_type | VARCHAR | - | 'none' \| 'day' \| '3night' \| '4night' |
| pass_expires_at | TIMESTAMP | - | 트립 패스 만료 시각 |
| is_beta_tester | BOOLEAN | ✅ | 베타 테스터 여부 (레전드 배지) |
| created_at | TIMESTAMP | ✅ | |

### places

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| name | VARCHAR | ✅ | 장소명 |
| location | GEOGRAPHY(POINT) | ✅ | PostGIS 좌표 |
| address | VARCHAR | - | 도로명 주소 |
| category_tags | TEXT[] | ✅ | ['먹방', '한식', '전통시장'] |
| source | VARCHAR | ✅ | 'tourapi' \| 'kakao' \| 'hidden_gem' |
| rarity_score | FLOAT | - | 희소성 점수 0~100 |
| review_count | INTEGER | - | 카카오 플레이스 리뷰 수 |
| is_hidden_gem | BOOLEAN | ✅ | Hidden Gem 배지 여부 |
| embedding | vector(1536) | - | pgvector 임베딩 |
| created_at | TIMESTAMP | ✅ | |

### routes

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| user_id | UUID | ✅ | FK → users |
| group_trip_id | UUID | - | FK → group_trips (그룹 모드) |
| title | VARCHAR | ✅ | 여행 제목 |
| destination | VARCHAR | ✅ | 목적지 |
| start_date | DATE | ✅ | 출발일 |
| end_date | DATE | ✅ | 귀환일 |
| nights | INTEGER | ✅ | 박 수 |
| people_count | INTEGER | ✅ | 인원 수 |
| total_budget | INTEGER | - | 총 예산 (원) |
| tags | TEXT[] | - | 여행 스타일 태그 |
| density | VARCHAR | - | 'relaxed' \| 'normal' \| 'packed' |
| is_public | BOOLEAN | ✅ | 커뮤니티 공유 여부 |
| save_count | INTEGER | ✅ | 저장 수 (기본값 0) |
| created_at | TIMESTAMP | ✅ | |

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
| pass_type | VARCHAR | ✅ | 'day' \| '3night' \| '4night' |
| amount | INTEGER | ✅ | 결제 금액 |
| payment_key | VARCHAR | ✅ | 토스페이먼츠 결제 키 |
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
-- 위치 기반 검색 (PostGIS)
CREATE INDEX idx_places_location ON places USING GIST(location);

-- 태그 필터 검색
CREATE INDEX idx_places_category_tags ON places USING GIN(category_tags);

-- Hidden Gems 희소성 정렬
CREATE INDEX idx_places_rarity ON places(rarity_score DESC) WHERE is_hidden_gem = true;

-- 루트 조회
CREATE INDEX idx_routes_user ON routes(user_id, created_at DESC);
CREATE INDEX idx_route_slots_route ON route_slots(route_id, day_number, order_index);

-- 지출 조회
CREATE INDEX idx_expenses_route ON expenses(route_id, created_at DESC);

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
  source: 'tourapi' | 'kakao' | 'hidden_gem';
  rarityScore?: number;
  isHiddenGem: boolean;
  reviewCount?: number;
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
  peopleCount: number;
  totalBudget?: number;
  tags: string[];
  density: 'relaxed' | 'normal' | 'packed';
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
  category: '숙박' | '식음료' | '교통' | '입장료' | '기념품' | '기타';
  plannedAmount?: number;
  actualAmount: number;
  memo?: string;
  createdAt: string;
}

// 트립 패스
type PassType = 'none' | 'day' | '3night' | '4night';

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

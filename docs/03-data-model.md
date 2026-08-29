# 데이터 모델

> **진실의 출처는 이 문서가 아니라 `backend/src/main/resources/db/migration/` (V1~V21)이다.**
> 이 문서는 그 21개 파일을 읽어 정리한 것이고, 어긋나면 마이그레이션이 맞다.
> 기준일 **2026-08-06** · V21까지 반영

---

## ERD — 실제로 존재하는 테이블 10개

```
users
  ├── routes (1:N)
  │     ├── route_slots (1:N)          일정 슬롯
  │     ├── route_day_summaries (1:N)  Day별 AI 요약 (day당 1건 UNIQUE)
  │     ├── accommodations (1:N)       숙소 (체크인~체크아웃 범위 1건)
  │     ├── expenses (1:N)             지출
  │     └── budget_settings (1:1)      예산 배분 비율
  ├── bookmarks (1:N)        ─┐
  └── route_bookmarks (1:N)  ─┼─ 둘 다 로그성. UNIQUE로 중복 방지
                              │
places ─────────────────────────┤
  ├── route_slots (1:N)         │  슬롯에 배치된 장소 (ON DELETE RESTRICT)
  └── bookmarks (1:N)  ─────────┘
```

**FK 삭제 정책이 한 곳만 다르다** — `route_slots.place_id`만 `ON DELETE RESTRICT`이고 나머지는 전부 `CASCADE`다. 루트에 쓰이는 장소는 지울 수 없다는 뜻이고, 폐업 처리는 삭제가 아니라 `places.is_active = false`로 한다.

### 아직 없는 테이블 — 문서에만 있던 것들

이전 버전 문서가 아래 4개를 스키마인 것처럼 적어놨지만 **마이그레이션에 없다.** 계획이다.

| 테이블 | 상태 |
|---|---|
| `hidden_gems` | 미생성. Hidden Gem은 `places.is_hidden_gem` 플래그 + `rarity_score`로만 존재 |
| `payments` | 미생성. 결제 미연동 (`PassValidationService` 33줄이 전부, PG 미확정) |
| `group_trips` · `group_members` | 미생성. `routes.group_trip_id` 컬럼만 FK 없이 자리를 잡아둔 상태 |

`events`(콘서트 앵커)도 마찬가지로 없다.

---

## 엔티티 정의

### users (V1, V15)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| oauth_provider | VARCHAR(20) | ✅ | 'google' \| 'apple' \| 'kakao'(국내 전용이라 외국인 타겟과 안 맞음 — 재검토 대상) |
| oauth_id | VARCHAR(255) | ✅ | 소셜 로그인 식별자 |
| nickname | VARCHAR(100) | ✅ | 표시 이름 |
| profile_image_url | TEXT | - | 프로필 이미지 |
| pass_type | VARCHAR(10) | ✅ | **CHECK: 'none' \| 'day' \| '3night' \| '4night'** ⚠️ 아래 참고 |
| pass_expires_at | TIMESTAMPTZ | - | 트립 패스 만료 시각 |
| is_beta_tester | BOOLEAN | ✅ | 기본값 false |
| persona_tags | TEXT[] | ✅ | V15. 페르소나 10종, 기본값 `{}` |
| onboarding_completed_at | TIMESTAMP | - | V15. NULL이면 온보딩 미완료 |
| created_at / updated_at | TIMESTAMPTZ | ✅ | `trg_users_updated_at` 자동 갱신 |

> ⚠️ **`pass_type` CHECK가 전략과 어긋나 있다.** DB는 `'day'`/`'3night'`/`'4night'`을 허용하는데, 2026-07-06 타겟 전환 후 상품은 **Standard / Extended** 2종이다. 결제 미구현이라 아직 드러나지 않았을 뿐, **결제를 붙이는 시점에 마이그레이션이 반드시 선행돼야 한다.**

- `UNIQUE (oauth_provider, oauth_id)` — 소셜 로그인 upsert 키

### places (V2, V10, V13, V14, V21)

가장 넓은 테이블이다. 성격별로 나눠 적는다. **`updated_at`이 없다** — 트리거도 없는 유일한 주요 테이블이다.

**기본**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| name | VARCHAR(200) | ✅ | 원본 표기 (한국어) |
| location | GEOGRAPHY(POINT, 4326) | ✅ | PostGIS. **`ST_DWithin` 단위가 미터** |
| address | TEXT | - | 도로명 주소 |
| source | VARCHAR(20) | ✅ | CHECK: `tourapi` \| `kakao` \| `naver`(V10) \| `hidden_gem` \| `manual`(V13) \| `event`(V13) |
| is_curated | BOOLEAN | ✅ | V13. 기본값 true. **false는 유저가 직접 추가한 장소뿐** |
| is_active | BOOLEAN | ✅ | 폐업 처리용. 기본값 true |
| created_at | TIMESTAMPTZ | ✅ | |

**태그 5종** — 전부 `TEXT[] NOT NULL DEFAULT '{}'`, 각각 GIN 인덱스

`category_tags` · `time_tags` · `cost_tags` · `companion_tags` · `access_tags`

**추천 신호**

| 필드 | 타입 | 설명 |
|------|------|------|
| avg_duration_minutes | INTEGER | 평균 체류 시간 |
| review_count | INTEGER | 리뷰 수 |
| is_hidden_gem | BOOLEAN | ✅ 기본값 false |
| rarity_score | FLOAT | CHECK 0~100. Hidden Gem 정렬용 |
| business_hours | JSONB | 요일별 영업시간 — ⚠️ **값을 넣는 코드가 없다** |
| trend_score / trend_updated_at / trend_source | FLOAT / TIMESTAMPTZ / TEXT[] | ⚠️ **네이버 블로그 검색 API 미발급이라 전부 비어 있다** |
| embedding | vector(1536) | text-embedding-3-small |

**다국어 (V14) — 8컬럼**

`name_en` `name_ja` `name_zh_hans` `name_zh_hant` / `address_en` `address_ja` `address_zh_hans` `address_zh_hant`

> 채우는 방식은 미확정이다(노션 「장소 데이터 영문화 방식 결정」 진행 중). 마이그레이션 주석의 안은 *큐레이션 배치는 배치 LLM 번역, 신규 장소는 첫 조회 시 실시간 번역 후 write-through*.

**운영정보 (V21) — 18컬럼**

프로액티브 규칙 6종(`CLOSED_DAY` `BREAK_TIME` `LAST_ENTRY` `RESERVATION_WALL` `LAST_TRANSIT` `PAYMENT_WALL`)의 데이터 기반이다.

| 묶음 | 컬럼 |
|---|---|
| Foreigner Friendly | `friendly_english_menu` `friendly_foreign_card` `friendly_english_kiosk` (SMALLINT 0~2) · `spice_level` (0~3) · `dietary_tags` TEXT[] |
| 시간 함정 | `break_time` JSONB `{"start":"HH:MM","end":"HH:MM"}` · `last_order_minutes` · `last_entry_minutes` |
| 진입 함정 | `reservation_required` · `walk_in_allowed` · `reservation_platform`(CHECK 6종) · `cash_only` · `min_party_size` |
| 찾기 | `signboard_name_ko` · `nearest_station` · `station_exit` |
| 휴관 | `closed_weekdays` SMALLINT[] (ISO-8601, 1=월) · `closed_on_holidays` |

> 🔑 **`NULL` = 미조사, `0` = 조사했는데 없음.** 서울·부산 200곳만 채울 계획이라 이 구분이 없으면 챗봇이 안 알아본 가게를 두고 *"영어메뉴 없어요"* 라고 단정한다. **규칙 함수는 `IS NOT NULL` 가드가 필수다.**

> **인덱스를 일부러 하나도 안 붙였다.** 아직 이 컬럼들을 쓰는 쿼리가 없어서, 규칙 구현 후 `EXPLAIN ANALYZE`로 실제 접근 패턴을 보고 붙인다. `WHERE is_curated = true` 부분 인덱스는 검토했다가 뺐다 — V13이 `DEFAULT true`로 넣어 21,543행이 전부 true라 선택도가 없다.

### routes (V3, V12, V16, V19, V20)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| user_id | UUID | ✅ | FK → users, CASCADE |
| group_trip_id | UUID | - | **FK 없음.** 테이블이 아직 없어 컬럼만 자리를 잡아둔 상태 |
| title | VARCHAR(200) | ✅ | |
| destination | VARCHAR(200) | ✅ | |
| start_date / end_date | DATE | ✅ | |
| nights | INTEGER | ✅ | CHECK >= 0 |
| group_type | VARCHAR(20) | ✅ | CHECK: solo \| couple \| friends \| family |
| budget_level | VARCHAR(20) | ✅ | **CHECK: budget \| mid \| premium** ⚠️ 아래 참고 |
| density | VARCHAR(20) | - | CHECK: relaxed \| normal \| packed |
| transport_mode | VARCHAR(20) | - | CHECK: transit \| car \| walk |
| total_budget | INTEGER | - | 숙박비 제외 현지 활동/식사 예산 |
| participant_count | INTEGER | - | 수집 안 함. 초대 기능 대비 보관 |
| accommodation_area | VARCHAR(200) | - | |
| tags | TEXT[] | ✅ | 기본값 `{}`. V16에서 GIN 인덱스 |
| is_public | BOOLEAN | ✅ | 커뮤니티 공개 |
| save_count | INTEGER | ✅ | 기본값 0 |
| display_order | INTEGER | ✅ | V12. 수동 드래그 정렬. 신규 루트는 최솟값-1로 맨 앞 |
| departure_at | TIMESTAMPTZ | - | V19. 프로액티브 `FLIGHT_DEPARTURE` 기준값 |
| return_at | TIMESTAMPTZ | - | V20. `RETURN_DEPARTURE` 기준값. `departure_at`과 대칭 |
| created_at / updated_at | TIMESTAMPTZ | ✅ | `trg_routes_updated_at` |

> ⛔ **`budget_level` CHECK와 앱이 어긋나 있다 (미해결 결함).**
> 앱 `step-2.tsx`는 **5단계**(`tight` `budget` `mid` `premium` `luxury`)를 제시하는데 DB CHECK는 가운데 3개만 허용한다. Spring은 `@NotBlank String`으로 그대로 통과시킨다(`RouteGenRequest.java:21`).
> → **「초절약」·「특별하게」를 고르면 INSERT가 CHECK 위반으로 실패한다.** `planning/unimplemented.md` 참고.

> 📌 `departure_at` / `return_at`은 `TIMESTAMPTZ`이고 Java는 `OffsetDateTime`으로 매핑한다. 오프셋 없는 `LocalDateTime`으로 받으면 프론트가 보내는 UTC ISO와 KST 사이에서 값이 어긋난다(2026-07-29 수정).

### route_slots (V4, V8, V9)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes, CASCADE |
| place_id | UUID | ✅ | FK → places, **RESTRICT** |
| day_number | INTEGER | ✅ | CHECK >= 1 |
| order_index | INTEGER | ✅ | CHECK >= 0 |
| start_time | TIME | - | `recomputeStartTimesForDay`가 09:00부터 Day 전체 재계산 |
| duration_minutes | INTEGER | - | CHECK > 0 |
| estimated_cost | INTEGER | - | CHECK >= 0 |
| is_pinned | BOOLEAN | ✅ | Pin & Reshuffle 고정. 기본값 false |
| transport_to_next | VARCHAR(20) | - | CHECK: walk \| transit \| taxi |
| transport_minutes | INTEGER | - | CHECK >= 0 |
| transit_summary | TEXT | - | V8. 노선+환승 요약 |
| transit_detail | TEXT | - | V9. 구간별 승하차 정류장 **JSON 문자열** (정적 정보, 실시간 도착 아님) |
| tips | TEXT | - | AI 생성 팁 |

> 🔑 **`UNIQUE (route_id, day_number, order_index)`가 재정렬 구현을 지배한다.**
> 순서를 바꾸려면 **2패스**가 필요하다 — 큰 오프셋으로 대피시킨 뒤 최종값 반영. 그리고 뒤 슬롯을 밀 때는 **한 건씩 flush** 해야 한다. Hibernate JDBC batch가 순서를 안 지켜 이 유니크 위반이 **실측됐다** (`RouteSlotService.java:516`).

- `created_at` 컬럼이 **없다** (`planning/unimplemented.md`에 기록된 미해결 항목)

### route_day_summaries (V6)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes, CASCADE |
| day_number | INTEGER | ✅ | CHECK >= 1 |
| summary | TEXT | ✅ | AI 생성 Day 요약 |
| created_at / updated_at | TIMESTAMPTZ | ✅ | 트리거 있음 |

- `UNIQUE (route_id, day_number)` — SSE 재전송 시 upsert가 성립하는 근거

### accommodations (V7)

**연박은 체크인~체크아웃 범위 하나로 관리한다** — 밤마다 레코드를 만들지 않는다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes, CASCADE |
| name | VARCHAR(200) | ✅ | |
| address | TEXT | - | |
| location | GEOGRAPHY(POINT, 4326) | ✅ | **`places`를 거치지 않고 좌표를 직접 갖는다** |
| check_in_date / check_out_date | DATE | ✅ | CHECK: out > in |
| source | VARCHAR(20) | ✅ | CHECK: kakao \| manual |
| created_at / updated_at | TIMESTAMPTZ | ✅ | 트리거 있음 |

> 🔑 **이 테이블이 「미지의 장소」 처리의 선례다.** 숙소는 큐레이션 대상이 아니라서 `places`에 넣지 않고 좌표를 직접 들고 있다. 콘서트장·유저 검색 장소도 같은 패턴을 재사용하기로 합의됐다 — `places`는 큐레이션 전용으로 남긴다.

### expenses (V4, V11)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes, CASCADE |
| slot_id | UUID | - | FK → route_slots, **SET NULL**. NULL이면 비계획 지출 |
| user_id | UUID | ✅ | FK → users, CASCADE |
| expense_type | VARCHAR(20) | ✅ | CHECK: planned \| unplanned |
| category | VARCHAR(20) | ✅ | CHECK: ACCOMMODATION \| FOOD \| TRANSPORT \| ADMISSION \| SOUVENIR \| ETC |
| planned_amount | INTEGER | - | CHECK >= 0 |
| actual_amount | INTEGER | ✅ | CHECK >= 0 |
| memo | TEXT | - | |
| created_at | TIMESTAMPTZ | ✅ | |

> V11에서 한글 리터럴(`'숙박'`)을 언어중립 코드값으로 바꿨다. 4개국어 지원에서 DB에 한국어를 두면 언어를 바꿀 때마다 데이터를 건드려야 한다.
> 앱 `ExpenseCategory` 타입은 `ACCOMMODATION`을 빼고 5종만 쓴다 — 숙박비는 `total_budget` 산정에서 제외하기로 한 결정과 맞는다.

### budget_settings (V4)

| 필드 | 타입 | 필수 | 기본값 |
|------|------|------|------|
| id | UUID | ✅ | PK |
| route_id | UUID | ✅ | FK → routes, CASCADE · **UNIQUE** |
| total_budget | INTEGER | ✅ | CHECK > 0 |
| accommodation_ratio | FLOAT | ✅ | 0.35 |
| food_ratio | FLOAT | ✅ | 0.30 |
| transport_ratio | FLOAT | ✅ | 0.20 |
| activity_ratio | FLOAT | ✅ | 0.10 |
| etc_ratio | FLOAT | ✅ | 0.05 |

> 비율 합계 검증은 **DB가 아니라 애플리케이션 레이어**에 있다. 부동소수 합계를 CHECK로 걸면 0.9999999에 걸린다.

### bookmarks (V3, V17) / route_bookmarks (V18)

둘 다 구조가 같은 로그성 테이블이다 — 생성/삭제만 하므로 `updated_at`과 트리거가 없다.

| 필드 | bookmarks | route_bookmarks |
|---|---|---|
| id | UUID PK | UUID PK |
| user_id | FK → users, CASCADE | FK → users, CASCADE |
| 대상 | `place_id` FK → places | `route_id` FK → routes |
| created_at | TIMESTAMPTZ | TIMESTAMPTZ |
| UNIQUE | (user_id, place_id) | (user_id, route_id) |

> ⚠️ **`bookmarks`는 V3와 V17 두 곳에서 생성된다.** V17이 "누락"으로 오판해 추가된 중복이었고, 기존 DB는 V3 시점에 이미 있어 문제가 안 드러났다. **빈 DB에서 V1부터 돌리면 여기서 실패**해서 2026-08-01에 `IF NOT EXISTS`로 멱등화했다.
> → 이미 적용된 DB는 checksum이 바뀌므로 **`./gradlew flywayRepair`가 필요하다.**

---

## 인덱스 — 마이그레이션에 실재하는 것 전부

```sql
-- users
CREATE INDEX idx_users_provider_id   ON users (oauth_provider, oauth_id);          -- V1
CREATE INDEX idx_users_persona_tags  ON users USING GIN (persona_tags);            -- V15

-- places : 위치 + 태그 5종 + 정렬 2종 + 임베딩
CREATE INDEX idx_places_location       ON places USING GIST(location);             -- V2
CREATE INDEX idx_places_category_tags  ON places USING GIN(category_tags);         -- V2
CREATE INDEX idx_places_time_tags      ON places USING GIN(time_tags);
CREATE INDEX idx_places_cost_tags      ON places USING GIN(cost_tags);
CREATE INDEX idx_places_companion_tags ON places USING GIN(companion_tags);
CREATE INDEX idx_places_access_tags    ON places USING GIN(access_tags);
CREATE INDEX idx_places_rarity ON places(rarity_score DESC) WHERE is_hidden_gem = true;
CREATE INDEX idx_places_trend  ON places(trend_score DESC NULLS LAST) WHERE is_active = true;
CREATE INDEX idx_places_embedding                                                  -- V5
    ON places USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- routes
CREATE INDEX idx_routes_user            ON routes(user_id, created_at DESC);       -- V3
CREATE INDEX idx_routes_public          ON routes(created_at DESC) WHERE is_public = true;
CREATE INDEX idx_routes_tags            ON routes USING GIN (tags);                -- V16
CREATE INDEX idx_routes_user_start_date ON routes (user_id, start_date);           -- V20

-- route_slots / route_day_summaries / accommodations
CREATE INDEX idx_route_slots_route        ON route_slots(route_id, day_number, order_index);
CREATE INDEX idx_route_slots_place        ON route_slots(place_id);
CREATE INDEX idx_route_day_summaries_route ON route_day_summaries(route_id, day_number);
CREATE INDEX idx_accommodations_route      ON accommodations(route_id, check_in_date);

-- 지출 / 북마크
CREATE INDEX idx_expenses_route        ON expenses(route_id, created_at DESC);
CREATE INDEX idx_expenses_user         ON expenses(user_id, created_at DESC);
CREATE INDEX idx_bookmarks_user        ON bookmarks(user_id, created_at DESC);
CREATE INDEX idx_bookmarks_place       ON bookmarks(place_id);
CREATE INDEX idx_route_bookmarks_user  ON route_bookmarks(user_id, created_at DESC); -- V18
CREATE INDEX idx_route_bookmarks_route ON route_bookmarks(route_id);
```

**설계 판단 3가지**

1. **`idx_routes_user_start_date`가 V20에 딸려 왔다** (V19가 아니라). 활성 루트 조회(`GET /v1/routes/active`)가 `user_id` + 날짜 범위로 필터하는데 기존 `idx_routes_user`는 `(user_id, created_at DESC)`라 `start_date` 범위 검색을 못 탄다.
2. **`idx_places_embedding`(ivfflat)은 데이터 적재 후에 만들어야 한다.** `lists = 100`은 26만 행 기준값이고, 현재 21,543행이라 과대설정이다. 100만 행을 넘으면 HNSW 전환을 검토한다.
3. **V21 운영정보 18컬럼에는 인덱스가 하나도 없다** — 위 places 절 참고.

---

## 앱 타입 정의

**여기에 중복해서 적지 않는다.** 프론트 타입의 진실은 `frontend/types/index.ts`(348줄) 한 곳이고, DB 컬럼과 1:1이 아니다 — 앱은 화면이 쓰는 형태(`SlotWithCoords`, `RouteListItem` 등)로 평탄화해서 받는다.

DB → API → 앱 사이 변환에서 알아둘 것 2가지:

- **`transit_detail`은 DB에 JSON 문자열로 들어 있다.** 앱은 `JSON.parse` 후 `TransitHop[]`로 다룬다.
- **프로액티브 응답에는 한국어가 없다.** 서버는 `{type, params}`(숫자·열거·시각)만 주고 문장은 앱 i18n이 조립한다 — 4개국어를 서버가 만들면 언어마다 프롬프트가 필요하고, 자유 문자열을 왕복시키면 프롬프트 주입 통로가 된다.

---

## 다음에 볼 것

| 알고 싶은 것 | 어디로 |
|---|---|
| 스키마 원문 | `backend/src/main/resources/db/migration/` V1~V21 |
| API 계약 | `docs/04-api-spec.md` |
| 코드가 실제로 어떻게 도는가 | `docs/08-codebase-guide.md` |
| 왜 이 설계인가 | `docs/superpowers/specs/` |
| 미해결 결함 | `planning/unimplemented.md` |

-- fn_set_updated_at() 트리거 함수는 V1에서 정의됨

BEGIN;

-- ============================================================
-- route_slots 테이블
-- ============================================================
CREATE TABLE route_slots (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id            UUID        NOT NULL
                            REFERENCES routes(id) ON DELETE CASCADE,
    place_id            UUID        NOT NULL
                            REFERENCES places(id) ON DELETE RESTRICT,

    day_number          INTEGER     NOT NULL CHECK (day_number >= 1),
    order_index         INTEGER     NOT NULL CHECK (order_index >= 0),

    start_time          TIME,
    duration_minutes    INTEGER     CHECK (duration_minutes > 0),
    estimated_cost      INTEGER     CHECK (estimated_cost >= 0),

    -- 슬롯 대안 추천 API (POST /ai/routes/slots/{id}/alternatives) 고정 여부
    is_pinned           BOOLEAN     NOT NULL DEFAULT false,

    transport_to_next   VARCHAR(20)
                            CHECK (transport_to_next IN ('walk', 'transit', 'taxi')),
    transport_minutes   INTEGER     CHECK (transport_minutes >= 0),

    tips                TEXT,

    -- 하나의 루트 안에서 (day, order)는 유일
    CONSTRAINT uk_route_slots_day_order UNIQUE (route_id, day_number, order_index)
);

-- ============================================================
-- expenses 테이블
-- ============================================================
CREATE TABLE expenses (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id       UUID        NOT NULL
                       REFERENCES routes(id) ON DELETE CASCADE,
    -- NULL이면 비계획 지출
    slot_id        UUID
                       REFERENCES route_slots(id) ON DELETE SET NULL,
    user_id        UUID        NOT NULL
                       REFERENCES users(id) ON DELETE CASCADE,

    expense_type   VARCHAR(20) NOT NULL
                       CHECK (expense_type IN ('planned', 'unplanned')),
    category       VARCHAR(20) NOT NULL
                       CHECK (category IN ('숙박', '식음료', '교통', '입장료', '기념품', '기타')),

    planned_amount  INTEGER     CHECK (planned_amount >= 0),
    actual_amount   INTEGER     NOT NULL CHECK (actual_amount >= 0),
    memo            TEXT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- budget_settings 테이블
-- ============================================================
CREATE TABLE budget_settings (
    id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id             UUID    NOT NULL
                             REFERENCES routes(id) ON DELETE CASCADE,
    total_budget         INTEGER NOT NULL CHECK (total_budget > 0),

    -- 비율 합계는 애플리케이션 레이어에서 검증 (1.0 = 100%)
    accommodation_ratio  FLOAT   NOT NULL DEFAULT 0.35,
    food_ratio           FLOAT   NOT NULL DEFAULT 0.30,
    transport_ratio      FLOAT   NOT NULL DEFAULT 0.20,
    activity_ratio       FLOAT   NOT NULL DEFAULT 0.10,
    etc_ratio            FLOAT   NOT NULL DEFAULT 0.05,

    CONSTRAINT uk_budget_settings_route UNIQUE (route_id)
);

-- ============================================================
-- 인덱스
-- ============================================================

-- 루트 슬롯 조회 (day별 정렬 — 지도/타임라인 뷰 핵심)
CREATE INDEX idx_route_slots_route
    ON route_slots(route_id, day_number, order_index);

-- 특정 장소가 어느 루트에 사용되는지 역조회
CREATE INDEX idx_route_slots_place
    ON route_slots(place_id);

-- 지출 목록 조회 (라우트별 최신순)
CREATE INDEX idx_expenses_route
    ON expenses(route_id, created_at DESC);

-- 개인 지출 조회 (그룹 여행 모드용)
CREATE INDEX idx_expenses_user
    ON expenses(user_id, created_at DESC);

COMMIT;

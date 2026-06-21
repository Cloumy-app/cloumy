-- fn_set_updated_at() 트리거 함수는 V1에서 정의됨

BEGIN;

-- ============================================================
-- routes 테이블
-- ============================================================
CREATE TABLE routes (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID         NOT NULL
                             REFERENCES users(id) ON DELETE CASCADE,
    -- 그룹 여행 모드 (Phase 2 — group_trips 테이블 추가 시 FK 추가 예정)
    group_trip_id        UUID,

    title                VARCHAR(200) NOT NULL,
    destination          VARCHAR(200) NOT NULL,
    start_date           DATE         NOT NULL,
    end_date             DATE         NOT NULL,
    nights               INTEGER      NOT NULL CHECK (nights >= 0),

    group_type           VARCHAR(20)  NOT NULL
                             CHECK (group_type IN ('solo', 'couple', 'friends', 'family')),
    budget_level         VARCHAR(20)  NOT NULL
                             CHECK (budget_level IN ('budget', 'mid', 'premium')),
    density              VARCHAR(20)
                             CHECK (density IN ('relaxed', 'normal', 'packed')),
    transport_mode       VARCHAR(20)
                             CHECK (transport_mode IN ('transit', 'car', 'walk')),

    -- 예산 관리 (원)
    total_budget         INTEGER,
    -- 인원 수 (그룹 초대 기능 대비 보관, MVP에서는 수집 안 함)
    participant_count    INTEGER,

    accommodation_area   VARCHAR(200),
    tags                 TEXT[]       NOT NULL DEFAULT '{}',

    is_public            BOOLEAN      NOT NULL DEFAULT false,
    save_count           INTEGER      NOT NULL DEFAULT 0,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- bookmarks 테이블
-- ============================================================
CREATE TABLE bookmarks (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL
                   REFERENCES users(id) ON DELETE CASCADE,
    place_id   UUID        NOT NULL
                   REFERENCES places(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_bookmarks_user_place UNIQUE (user_id, place_id)
);

-- ============================================================
-- 인덱스
-- ============================================================

-- 내 루트 목록 조회 (user_id 필터 + 최신순 정렬)
CREATE INDEX idx_routes_user
    ON routes(user_id, created_at DESC);

-- 공개 루트 목록 (커뮤니티 피드)
CREATE INDEX idx_routes_public
    ON routes(created_at DESC)
    WHERE is_public = true;

-- 북마크 목록 조회 (user_id 기준)
CREATE INDEX idx_bookmarks_user
    ON bookmarks(user_id, created_at DESC);

-- 특정 장소의 북마크 수 집계
CREATE INDEX idx_bookmarks_place
    ON bookmarks(place_id);

COMMIT;

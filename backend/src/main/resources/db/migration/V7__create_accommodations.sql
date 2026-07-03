-- fn_set_updated_at() 트리거 함수는 V1에서 정의됨

BEGIN;

-- ============================================================
-- accommodations 테이블
-- ============================================================
-- 연박은 체크인~체크아웃 범위 하나로 관리(밤마다 레코드 생성 안 함)
CREATE TABLE accommodations (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id        UUID                    NOT NULL
                        REFERENCES routes(id) ON DELETE CASCADE,

    name            VARCHAR(200)            NOT NULL,
    address         TEXT,
    location        GEOGRAPHY(POINT, 4326)  NOT NULL,

    check_in_date   DATE                    NOT NULL,
    check_out_date  DATE                    NOT NULL
                        CHECK (check_out_date > check_in_date),

    source          VARCHAR(20)             NOT NULL
                        CHECK (source IN ('kakao', 'manual')),

    created_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_accommodations_updated_at
    BEFORE UPDATE ON accommodations
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- 인덱스
-- ============================================================

-- 루트별 숙소 목록 조회 (체크인 날짜순)
CREATE INDEX idx_accommodations_route
    ON accommodations(route_id, check_in_date);

COMMIT;

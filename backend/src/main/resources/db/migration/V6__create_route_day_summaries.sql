-- fn_set_updated_at() 트리거 함수는 V1에서 정의됨

BEGIN;

-- ============================================================
-- route_day_summaries 테이블
-- ============================================================
CREATE TABLE route_day_summaries (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id    UUID        NOT NULL
                    REFERENCES routes(id) ON DELETE CASCADE,
    day_number  INTEGER     NOT NULL CHECK (day_number >= 1),
    summary     TEXT        NOT NULL,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 하나의 루트 안에서 day당 요약은 하나 (재전송 시 upsert)
    CONSTRAINT uk_route_day_summaries_route_day UNIQUE (route_id, day_number)
);

CREATE TRIGGER trg_route_day_summaries_updated_at
    BEFORE UPDATE ON route_day_summaries
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- 인덱스
-- ============================================================

-- 루트 상세 화면에서 day별 요약 조회
CREATE INDEX idx_route_day_summaries_route
    ON route_day_summaries(route_id, day_number);

COMMIT;

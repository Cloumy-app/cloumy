BEGIN;

-- ============================================================
-- route_bookmarks 테이블
-- ============================================================
-- bookmarks(장소 북마크)와 동일 구조 — 로그성 테이블, updated_at/트리거 불필요
CREATE TABLE route_bookmarks (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID            NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,
    route_id    UUID            NOT NULL
                    REFERENCES routes(id) ON DELETE CASCADE,

    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, route_id)
);

-- ============================================================
-- 인덱스
-- ============================================================

-- 내 루트 북마크 목록 조회 (최신순)
CREATE INDEX idx_route_bookmarks_user
    ON route_bookmarks(user_id, created_at DESC);

-- 루트 삭제 시 역참조 조회(route_id 단독)
CREATE INDEX idx_route_bookmarks_route
    ON route_bookmarks(route_id);

COMMIT;

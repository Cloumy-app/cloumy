BEGIN;

-- ============================================================
-- bookmarks 테이블
-- ============================================================
-- 로그성 테이블: 수정 없이 생성/삭제만 하므로 updated_at·트리거 불필요
CREATE TABLE bookmarks (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID            NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,
    place_id    UUID            NOT NULL
                    REFERENCES places(id) ON DELETE CASCADE,

    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, place_id)
);

-- ============================================================
-- 인덱스
-- ============================================================

-- 내 북마크 목록 조회 (최신순)
CREATE INDEX idx_bookmarks_user
    ON bookmarks(user_id, created_at DESC);

-- place 삭제 시 역참조 조회(place_id 단독)
CREATE INDEX idx_bookmarks_place
    ON bookmarks(place_id);

COMMIT;

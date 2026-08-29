BEGIN;

-- ============================================================
-- bookmarks 테이블
-- ============================================================
-- ⚠️ 이 테이블은 V3(V3__create_routes.sql)에서 이미 생성된다.
--    V17은 "bookmarks 마이그레이션 누락"으로 판단해 추가됐으나 실제로는 중복이었다.
--    기존 DB는 V3 시점에 테이블이 있어 문제가 드러나지 않았지만,
--    빈 DB에서 V1부터 돌리면 여기서 `relation "bookmarks" already exists`로 실패한다.
--    → IF NOT EXISTS로 멱등하게 만들어 clean DB 초기화를 복구한다. (2026-08-01)
--    적용 완료된 DB는 checksum이 바뀌므로 `./gradlew flywayRepair` 필요.
--
-- 로그성 테이블: 수정 없이 생성/삭제만 하므로 updated_at·트리거 불필요
CREATE TABLE IF NOT EXISTS bookmarks (
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
CREATE INDEX IF NOT EXISTS idx_bookmarks_user
    ON bookmarks(user_id, created_at DESC);

-- place 삭제 시 역참조 조회(place_id 단독)
CREATE INDEX IF NOT EXISTS idx_bookmarks_place
    ON bookmarks(place_id);

COMMIT;

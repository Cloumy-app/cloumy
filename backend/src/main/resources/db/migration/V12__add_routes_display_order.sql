-- ============================================================
-- V12: routes.display_order 추가 — 사용자 수동 드래그 정렬 지원
-- 기존 라우트는 현재 created_at DESC 순서 그대로 백필해 정렬 기준을
-- 바꿔도 화면에 보이는 순서가 즉시 바뀌지 않도록 한다.
-- ============================================================
BEGIN;

ALTER TABLE routes ADD COLUMN display_order INTEGER;

UPDATE routes r
SET display_order = sub.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1 AS rn
    FROM routes
) sub
WHERE r.id = sub.id;

ALTER TABLE routes ALTER COLUMN display_order SET NOT NULL;

COMMIT;

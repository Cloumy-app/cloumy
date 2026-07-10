-- ============================================================
-- V16: routes.tags GIN 인덱스 — 페르소나 자동추가 카운트 쿼리 성능용
-- 설계: docs/superpowers/specs/2026-07-10-persona-tag-system-design.md
-- ============================================================
BEGIN;

CREATE INDEX idx_routes_tags ON routes USING GIN (tags);

COMMIT;

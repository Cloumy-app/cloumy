-- ============================================================
-- V15: users 페르소나 태그(10종) + 온보딩 완료 시각 추가
-- 설계: docs/superpowers/specs/2026-07-10-persona-tag-system-design.md
-- ============================================================
BEGIN;

ALTER TABLE users
    ADD COLUMN persona_tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN onboarding_completed_at TIMESTAMP;

CREATE INDEX idx_users_persona_tags ON users USING GIN (persona_tags);

COMMIT;

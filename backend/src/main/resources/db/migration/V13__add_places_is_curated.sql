-- ============================================================
-- V13: places.is_curated 플래그 신설 + source CHECK에 manual/event 추가
-- ============================================================
BEGIN;

ALTER TABLE places ADD COLUMN is_curated BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE places DROP CONSTRAINT places_source_check;
ALTER TABLE places ADD CONSTRAINT places_source_check
    CHECK (source IN ('tourapi', 'kakao', 'naver', 'hidden_gem', 'manual', 'event'));

COMMIT;

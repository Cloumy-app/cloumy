-- ============================================================
-- V8: route_slots에 대중교통 노선 요약 컬럼 추가
-- ============================================================
BEGIN;

ALTER TABLE route_slots ADD COLUMN transit_summary TEXT;

COMMIT;

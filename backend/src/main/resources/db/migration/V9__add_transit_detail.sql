-- ============================================================
-- V9: route_slots에 대중교통 구간별 상세(승하차 정류장) 컬럼 추가
-- ============================================================
BEGIN;

ALTER TABLE route_slots ADD COLUMN transit_detail TEXT;

COMMIT;

-- ============================================================
-- V10: places.source CHECK 제약에 'naver' 추가 (네이버 지역검색 API 신규 소스)
-- ============================================================
BEGIN;

ALTER TABLE places DROP CONSTRAINT places_source_check;
ALTER TABLE places ADD CONSTRAINT places_source_check
    CHECK (source IN ('tourapi', 'kakao', 'naver', 'hidden_gem'));

COMMIT;

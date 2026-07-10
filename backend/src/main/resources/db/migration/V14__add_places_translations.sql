-- ============================================================
-- V14: places 다국어 번역 컬럼 추가 (영/일/중국어간체/중국어번체)
-- 방식 결정: 큐레이션 배치는 배치 LLM 번역, 신규(카카오 검색 추가) 장소는
-- 첫 조회 시 실시간 번역 후 write-through 캐시 (노션 "장소 데이터 영문화 방식 결정" 참고)
-- ============================================================
BEGIN;

ALTER TABLE places
    ADD COLUMN name_en         VARCHAR(200),
    ADD COLUMN name_ja         VARCHAR(200),
    ADD COLUMN name_zh_hans    VARCHAR(200),
    ADD COLUMN name_zh_hant    VARCHAR(200),
    ADD COLUMN address_en      TEXT,
    ADD COLUMN address_ja      TEXT,
    ADD COLUMN address_zh_hans TEXT,
    ADD COLUMN address_zh_hant TEXT;

COMMIT;

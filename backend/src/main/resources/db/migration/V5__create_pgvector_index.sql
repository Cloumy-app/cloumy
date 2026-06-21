-- vector 확장은 db/init.sql에서 이미 설치됨 (Flyway 밖)
-- ivfflat 인덱스는 데이터 적재 이후에 실행해야 검색 품질이 좋음
-- 시드 데이터(TourAPI 배치) 완료 후 이 마이그레이션을 적용할 것
--
-- lists 파라미터 기준:
--   rows < 1,000   → lists = 1 (인덱스 없어도 무방)
--   rows = 26만    → lists = 100 (rows/1000, 최소 1)
--   rows > 100만   → HNSW로 전환 검토

BEGIN;

-- places.embedding: text-embedding-3-small (1536차원) cosine 유사도 검색
CREATE INDEX idx_places_embedding
    ON places USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMIT;

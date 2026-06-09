-- PostGIS: 위치 기반 검색 (ST_DWithin 반경 검색)
CREATE EXTENSION IF NOT EXISTS postgis;

-- pgvector: 임베딩 유사도 검색 (<=> 코사인 유사도)
CREATE EXTENSION IF NOT EXISTS vector;

-- 설치 확인
DO $$
BEGIN
  RAISE NOTICE 'Extensions: postgis=%, vector=%',
    (SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'),
    (SELECT default_version FROM pg_available_extensions WHERE name = 'vector');
END $$;

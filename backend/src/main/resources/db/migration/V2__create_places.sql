-- postgis, vector 확장은 db/init.sql에서 이미 설치됨 (Flyway 밖)
-- fn_set_updated_at() 트리거 함수는 V1에서 정의됨 — 재정의 불필요

BEGIN;

-- ============================================================
-- places 테이블
-- ============================================================
CREATE TABLE places (
    id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 VARCHAR(200)            NOT NULL,

    -- GEOGRAPHY: 구면 좌표계 (ST_DWithin 단위 = 미터, WGS84 SRID 4326)
    location             GEOGRAPHY(POINT, 4326)  NOT NULL,

    address              TEXT,

    -- 멀티 태그 (GIN 인덱스 대상)
    category_tags        TEXT[]                  NOT NULL DEFAULT '{}',
    time_tags            TEXT[]                  NOT NULL DEFAULT '{}',
    cost_tags            TEXT[]                  NOT NULL DEFAULT '{}',
    companion_tags       TEXT[]                  NOT NULL DEFAULT '{}',
    access_tags          TEXT[]                  NOT NULL DEFAULT '{}',

    -- 데이터 출처
    source               VARCHAR(20)             NOT NULL
                             CHECK (source IN ('tourapi', 'kakao', 'hidden_gem')),

    -- 장소 상세 정보
    avg_duration_minutes INTEGER,
    business_hours       JSONB,
    review_count         INTEGER,
    is_active            BOOLEAN                 NOT NULL DEFAULT true,

    -- Hidden Gems
    is_hidden_gem        BOOLEAN                 NOT NULL DEFAULT false,
    rarity_score         FLOAT
                             CHECK (rarity_score BETWEEN 0 AND 100),

    -- 트렌딩 (네이버 블로그 API 기반 주 1회 갱신)
    trend_score          FLOAT,
    trend_updated_at     TIMESTAMPTZ,
    trend_source         TEXT[]                  NOT NULL DEFAULT '{}',

    -- pgvector 임베딩 (text-embedding-3-small, 1536차원)
    -- ivfflat 인덱스는 V5에서 데이터 적재 후 생성
    embedding            vector(1536),

    created_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 인덱스
-- ============================================================

-- PostGIS 위치 기반 반경 검색 (ST_DWithin 필수)
CREATE INDEX idx_places_location
    ON places USING GIST(location);

-- 태그 필터 검색 (@> 연산자, ANY() 포함)
CREATE INDEX idx_places_category_tags
    ON places USING GIN(category_tags);

CREATE INDEX idx_places_time_tags
    ON places USING GIN(time_tags);

CREATE INDEX idx_places_cost_tags
    ON places USING GIN(cost_tags);

CREATE INDEX idx_places_companion_tags
    ON places USING GIN(companion_tags);

CREATE INDEX idx_places_access_tags
    ON places USING GIN(access_tags);

-- Hidden Gems 희소성 정렬 (부분 인덱스 — Hidden Gem 행만 포함)
CREATE INDEX idx_places_rarity
    ON places(rarity_score DESC)
    WHERE is_hidden_gem = true;

-- 트렌딩 정렬 (활성 장소만, RAG 가중치 조회용)
CREATE INDEX idx_places_trend
    ON places(trend_score DESC NULLS LAST)
    WHERE is_active = true;

COMMIT;

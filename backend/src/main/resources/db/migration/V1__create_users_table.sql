-- gen_random_uuid()는 PostgreSQL 13+에서 pgcrypto 없이 기본 제공
-- postgis, vector 확장은 db/init.sql에서 이미 설치됨

BEGIN;

-- ============================================================
-- users 테이블
-- ============================================================
CREATE TABLE users (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_provider    VARCHAR(20) NOT NULL,
    oauth_id          VARCHAR(255) NOT NULL,
    nickname          VARCHAR(100) NOT NULL,
    profile_image_url TEXT,
    pass_type         VARCHAR(10) NOT NULL DEFAULT 'none'
                          CHECK (pass_type IN ('none', 'day', '3night', '4night')),
    pass_expires_at   TIMESTAMPTZ,
    is_beta_tester    BOOLEAN     NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_users_provider_id UNIQUE (oauth_provider, oauth_id)
);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- 인덱스
-- ============================================================

-- 소셜 로그인 upsert 조회 (provider + oauth_id 복합 조회가 핵심 패턴)
CREATE INDEX idx_users_provider_id ON users (oauth_provider, oauth_id);

COMMIT;

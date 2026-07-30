-- ============================================================
-- V20: routes.return_at 컬럼 신설
-- ============================================================
BEGIN;

-- 오는 편 출발 일시(선택 입력) — 프로액티브 귀가 준비 알림(RETURN_DEPARTURE)의 기준값.
-- departure_at과 대칭. NULL 허용: 미입력 시 해당 규칙만 동작 안 한다.
ALTER TABLE routes ADD COLUMN return_at TIMESTAMPTZ;

-- 활성 루트 조회(GET /v1/routes/active)가 user_id + 날짜 범위로 필터한다.
-- 기존 idx_routes_user는 (user_id, created_at DESC)라 start_date 범위 검색을 못 탄다.
CREATE INDEX idx_routes_user_start_date ON routes (user_id, start_date);

COMMIT;

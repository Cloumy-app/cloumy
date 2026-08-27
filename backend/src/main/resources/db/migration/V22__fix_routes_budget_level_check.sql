-- ============================================================
-- V22: routes.budget_level CHECK를 5종으로 확장
-- ============================================================
-- 왜: 앱(step-2.tsx)과 AI(schemas.py)는 5단계로 나가 있는데 V3의 CHECK만 3종에 멈춰 있다.
--     tight/luxury를 고르면 INSERT가 제약 위반으로 죽어 루트 생성이 500이 된다.
--     앱이 이미 5단계 UX로 출시돼 있으므로 DB를 앱에 맞추는 방향으로 고친다.
-- ============================================================
BEGIN;

ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_budget_level_check;
ALTER TABLE routes ADD CONSTRAINT routes_budget_level_check
    CHECK (budget_level IN ('tight', 'budget', 'mid', 'premium', 'luxury'));

COMMIT;

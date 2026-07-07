-- ============================================================
-- V11: expenses.category 한글 리터럴 → 언어중립 코드값
-- ============================================================
BEGIN;

UPDATE expenses SET category = CASE category
    WHEN '숙박' THEN 'ACCOMMODATION'
    WHEN '식음료' THEN 'FOOD'
    WHEN '교통' THEN 'TRANSPORT'
    WHEN '입장료' THEN 'ADMISSION'
    WHEN '기념품' THEN 'SOUVENIR'
    WHEN '기타' THEN 'ETC'
    ELSE category
END;

ALTER TABLE expenses DROP CONSTRAINT expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
    CHECK (category IN ('ACCOMMODATION', 'FOOD', 'TRANSPORT', 'ADMISSION', 'SOUVENIR', 'ETC'));

COMMIT;

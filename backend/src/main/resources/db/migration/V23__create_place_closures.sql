-- ============================================================
-- V23: place_closures — 요일 규칙으로 표현 안 되는 휴관을 날짜로 직접 적재
-- ============================================================
-- 왜: closed_weekdays(V21)는 "매주 월요일"만 표현한다. 실제로는 특정 날짜 3개만 닫는
--     박물관, "매월 마지막 월요일"인 곳이 흔하다. 요일 규칙과 날짜 예외를 OR로 판정한다.
--
-- 설계 판단
--  1) 공휴일 캘린더(holidays)와 대체휴관 판정 로직은 만들지 않는다. 대체휴관은 "정기휴일이
--     공휴일과 겹치면 개방하고 그다음 첫 비공휴일이 휴일"처럼 기관별 정책이라 코드로
--     일반화할 수 없다. 기관 공지에 실제 날짜가 나오므로 그걸 넣는다.
--  2) updated_at·트리거를 두지 않는다. INSERT/DELETE만 있고 UPDATE가 없다
--     (휴관일이 바뀌면 그 행을 지우고 새로 넣는다).
--  3) 인덱스를 따로 두지 않는다. PK (place_id, closed_date)가 곧 조회 경로다.
-- ============================================================
BEGIN;

CREATE TABLE place_closures (
    place_id    UUID        NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    closed_date DATE        NOT NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (place_id, closed_date)
);

COMMENT ON TABLE place_closures IS
    'closed_weekdays(요일 규칙)로 표현 안 되는 휴관 날짜. 둘을 OR로 판정한다.';

COMMIT;

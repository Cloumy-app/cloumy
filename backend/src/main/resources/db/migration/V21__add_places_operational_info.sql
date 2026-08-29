-- ============================================================
-- V21: places 운영정보 컬럼 추가 — 프로액티브 개입의 데이터 기반
-- ============================================================
-- 왜: 프로액티브 규칙 6종(CLOSED_DAY/BREAK_TIME/LAST_ENTRY/RESERVATION_WALL/
--     PAYMENT_WALL)이 전부 이 데이터에 막혀 있다. business_hours(V2)는
--     선언만 돼 있고 값을 넣는 코드가 저장소에 없다.
--
-- 설계 판단
--  1) Foreigner Friendly Score(01-prd P1)와 운영정보를 한 마이그레이션에 같이 넣는다.
--     따로 하면 같은 테이블을 두 번 건드린다.
--  2) NULL = 미조사, 0 = 조사했는데 없음. 서울·부산 200곳만 채우므로 이 구분이 없으면
--     챗봇이 "이 집은 영어메뉴 없어요"라고 단정한다(실제로는 안 알아본 것).
--     → 규칙 함수는 반드시 IS NOT NULL 가드를 둘 것.
--  3) 별도 테이블이 아니라 컬럼 확장. places는 21,543행뿐이라 조인 비용이 아깝다.
--  4) 합산 friendly_score 컬럼은 만들지 않는다. 항목별로 쓰지 합산을 쓰는 화면이 없다.
-- ============================================================
BEGIN;

ALTER TABLE places
    -- --- Foreigner Friendly Score (0=없음 1=일부 2=완비, NULL=미조사) ---
    ADD COLUMN friendly_english_menu   SMALLINT
                    CHECK (friendly_english_menu BETWEEN 0 AND 2),
    -- 한국 결제단말은 VAN 독자망이라 국제 EMV 지원이 소수다. 기본값 없이 실측만 담는다.
    ADD COLUMN friendly_foreign_card   SMALLINT
                    CHECK (friendly_foreign_card BETWEEN 0 AND 2),
    ADD COLUMN friendly_english_kiosk  SMALLINT
                    CHECK (friendly_english_kiosk BETWEEN 0 AND 2),
    ADD COLUMN spice_level             SMALLINT
                    CHECK (spice_level BETWEEN 0 AND 3),
    ADD COLUMN dietary_tags            TEXT[],   -- {vegan, halal, gluten_free}

    -- --- 시간 함정 ---
    -- {"start":"15:00","end":"17:00"} — 요일별 예외가 생길 수 있어 business_hours와 같은 JSONB
    ADD COLUMN break_time              JSONB,
    ADD COLUMN last_order_minutes      SMALLINT,  -- 마감 N분 전 주문 마감
    ADD COLUMN last_entry_minutes      SMALLINT,  -- 폐장 N분 전 입장 마감 (궁·박물관)

    -- --- 진입 함정 ---
    ADD COLUMN reservation_required    BOOLEAN,
    ADD COLUMN walk_in_allowed         BOOLEAN,
    ADD COLUMN reservation_platform    VARCHAR(30)
                    CHECK (reservation_platform IN
                        ('catchtable_global', 'catchtable', 'naver', 'tabling', 'phone', 'none')),
    ADD COLUMN cash_only               BOOLEAN,
    ADD COLUMN min_party_size          SMALLINT,  -- 1인 입장 거부/최소 2인분 주문

    -- --- 찾기 (로마자 표기 불일치로 간판을 못 읽는 문제) ---
    ADD COLUMN signboard_name_ko       VARCHAR(200),
    ADD COLUMN nearest_station         VARCHAR(100),
    ADD COLUMN station_exit            VARCHAR(10),

    -- --- 휴관 ---
    ADD COLUMN closed_weekdays         SMALLINT[],  -- ISO-8601: 1=월 ... 7=일
    ADD COLUMN closed_on_holidays      BOOLEAN;

-- ============================================================
-- 인덱스: 없음 (의도적)
-- ============================================================
-- 이 컬럼들을 쓰는 쿼리가 아직 없다. 프로액티브 규칙(T4)이 나온 뒤
-- EXPLAIN ANALYZE로 실제 접근 패턴을 보고 추가한다.
--
-- ⚠️ `WHERE is_curated = true` 부분 인덱스를 검토했다가 뺐다 —
--    V13이 `DEFAULT true`로 컬럼을 추가해 기존 21,543행이 전부 true다.
--    (is_curated=false는 유저가 직접 추가한 장소뿐 → PlaceService.java)
--    테이블의 99%를 덮는 부분 인덱스라 선택도가 없고 쓰기 비용만 늘린다.

-- 표기 규약이 코드에서 바로 안 보이는 컬럼에만 주석을 남긴다
-- (나머지는 컬럼명으로 자명하거나 CHECK 제약에 범위가 드러남)
COMMENT ON COLUMN places.friendly_english_menu IS 'NULL=미조사, 0=없음, 1=일부, 2=완비';
COMMENT ON COLUMN places.break_time            IS '{"start":"HH:MM","end":"HH:MM"} / NULL=미조사';
COMMENT ON COLUMN places.closed_weekdays       IS 'ISO-8601 요일 배열 (1=월 ... 7=일) / NULL=미조사';

COMMIT;

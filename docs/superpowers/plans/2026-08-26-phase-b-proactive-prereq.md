# Phase B — 프로액티브 선행 조건 3건

> **스택**: 공통(Spring + FastAPI + Frontend) · DB
> **참조 전문가 스킬**: `fastapi-expert` · `postgres-expert` · `spring-expert` · `frontend-expert`
> **선행**: 없음 (Phase A와 병렬 가능)
> **후행**: Phase C 규칙 6종이 이 세 건에 전부 막혀 있다

규칙 6종을 만들기 전에 반드시 끝내야 하는 것들이다.
**나중에 하면 서버·프론트·params 계약을 동시에 뒤집어야 한다.**

---

## 실패 시나리오 (FFE)

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | dismiss 키의 날짜가 서버·클라이언트 간에 어긋난다 | 자정 근처에 dismiss가 안 먹거나 하루 일찍 풀림 | **KST 고정.** Spring `LocalDate.now(ZoneId.of("Asia/Seoul"))`, FastAPI `datetime.now(_KST).date()`. 기기 로컬 날짜(`toLocalDateString`)를 쓰던 기존 MMKV도 KST로 통일 |
| 2 | Redis 장애로 dismiss 기록 실패 | `RedisConnectionFailureException` | **fail-open** — 기록은 실패해도 개입 조회는 정상 진행. `RateLimitFilter.java:80-84` 패턴. 최악의 결과가 "닫은 배너가 다시 뜬다"라 감수 가능 |
| 3 | Redis 장애로 dismissed 조회 실패 (FastAPI) | `redis.exceptions.RedisError` | **fail-open** — 빈 set으로 간주하고 진행. 기존 `_load_day_weather`의 graceful 폴백과 같은 정책 |
| 4 | 프론트가 placeId를 안 보내 기존 9종과 신규 6종이 섞인다 | 장소 무관 규칙이 특정 장소로 기록됨 | 장소 무관 규칙은 멤버를 `{TYPE}:-`로 **명시적으로** 고정. `null`을 문자열 `"null"`로 흘리지 않게 주의 |
| 5 | `place_closures` FK 위반 — 시드 CSV에 없는 place_id | INSERT 시 `foreign key violation` | 시드 스크립트가 **place_id를 이름+좌표로 조회해서 해결**한다. CSV에 UUID를 손으로 적게 하지 않는다 |
| 6 | 시드가 모르는 값을 0으로 채운다 | — | **NULL = 미조사, 0 = 조사했는데 없음.** CSV 빈 칸은 반드시 NULL로 들어가야 한다. 0으로 채우면 챗봇이 "이 집은 영어메뉴 없어요"라고 단정한다 |
| 7 | 시드를 두 번 돌려 중복 INSERT | PK 위반 | `place_closures`는 `ON CONFLICT DO NOTHING`, places 운영정보는 UPDATE라 멱등 |
| 8 | `business_hours` 없이 `last_entry_minutes`만 채운다 | `LAST_ENTRY` 규칙이 조용히 안 뜸 | 시드 스크립트가 **`last_entry_minutes`가 있는데 `business_hours`가 비면 경고를 찍는다** |

---

## B-1. dismiss 구조 개편 — placeId + 서버 필터링

### 왜 지금인가

현재 dismiss는 **100% 클라이언트 로컬**이다. `frontend/lib/proactiveDismissal.ts`의
MMKV 키가 `proactive:{routeId}:{type}:{날짜}` — **placeId가 없다.**
`POST /v1/routes/{routeId}/proactive/feedback`은 `ProactiveController.java:53`에서
`log.info`만 하고 아무것도 저장하지 않는다.

**두 가지 구조적 파탄**:

- **L1 — 키에 placeId가 없다.** 신규 6종은 전부 장소 단위다.
  A식당 브레이크타임을 닫으면 그날 B박물관 `LAST_ENTRY`도 같이 죽는다.
- **L2 — `_select`가 `min(priority)` 1개만 반환한다.**
  기존 9종은 전부 시간창 기반이라 자연 소멸하는데(`0 <= minutes_left <= 60`),
  `CLOSED_DAY`·`PAYMENT_WALL`·`RESERVATION_WALL`은 **상태 기반이라 하루 종일 참**이다.
  한 번 걸리면 유저가 닫아도 서버는 계속 같은 걸 뱉는다 → **그날 나머지 개입 전멸.**
  프론트 필터만으로는 구조적으로 못 막는다.

### 설계

Spring이 쓰고 FastAPI가 읽는다. docker-compose의 Redis 단일 인스턴스를 공유하고,
Spring은 `StringRedisTemplate`, FastAPI는 `redis.asyncio`(`decode_responses=True`)라
문자열 SET으로 그대로 호환된다.

```
KEY     proactive:dismissed:{userId}:{routeId}:{yyyy-MM-dd}     ← 날짜는 KST 고정
MEMBER  "{TYPE}:{placeId}"      장소 단위 규칙 (신규 6종)
        "{TYPE}:-"              장소 무관 규칙 (기존 9종)
TTL     48h                     자정 경계에서 잘리지 않게 여유를 둔다
```

### Step 1 — Spring: 기록

`ProactiveFeedbackRequest.java` — `placeId` 필드 추가 (선택 값, 장소 무관 규칙은 null):

```java
public record ProactiveFeedbackRequest(
        @NotBlank @Pattern(regexp = ProactiveIntervention.TYPE_PATTERN) String type,
        @NotBlank @Pattern(regexp = "tapped|dismissed|auto_shown") String action,
        // 신규 6종은 장소 단위라 같은 type이어도 장소가 다르면 별개로 닫혀야 한다.
        // 장소 무관 규칙(기존 9종)은 null.
        UUID placeId
) {}
```

`ProactiveController.java:45-55` — `log.info`는 유지하고 **상태 기록을 추가**:

```java
        log.info("[proactive] {} type={} route={} user={}", req.action(), req.type(), routeId, userId);
        if ("dismissed".equals(req.action())) {
            recordDismissal(userId, routeId, req);
        }
```

```java
    // 프론트 MMKV만으론 못 막는다 — _select가 priority 최솟값 1개만 반환하는데
    // 상태형 규칙(CLOSED_DAY 등)은 하루 종일 참이라, 서버가 안 걸러주면
    // 유저가 닫은 개입 하나가 그날 나머지 개입을 전부 가린다.
    private void recordDismissal(UUID userId, UUID routeId, ProactiveFeedbackRequest req) {
        String today = LocalDate.now(KST).toString();          // 날짜 기준은 FastAPI와 동일하게 KST
        String key = "proactive:dismissed:%s:%s:%s".formatted(userId, routeId, today);
        String member = req.type() + ":" + (req.placeId() != null ? req.placeId() : "-");
        try {
            redisTemplate.opsForSet().add(key, member);
            redisTemplate.expire(key, Duration.ofHours(48));
        } catch (Exception e) {
            // Redis 장애 시 fail-open — 최악이 "닫은 배너가 다시 뜬다"라 개입 조회를 막을 이유가 없다
            log.warn("dismiss 기록 실패 — 무시: {}", e.getMessage());
        }
    }
```

**주의**: `ProactiveController`에 `StringRedisTemplate` 주입이 새로 필요하다. 전용 서비스 계층은 만들지 않는다 —
이 컨트롤러는 원래 서비스 없이 `AiServiceClient`를 직접 쓰는 구조다(기존 판단 유지).

### Step 2 — FastAPI: 필터링

`ai/app/services/proactive_service.py`

```python
async def _load_dismissed(redis, user_id: str, route_id: str, now: datetime) -> set[str]:
    """오늘 유저가 닫은 개입 목록. Redis 장애 시 빈 set — 개입을 막지 않는다(FFE #3)."""
    key = f"proactive:dismissed:{user_id}:{route_id}:{now.date().isoformat()}"
    try:
        return set(await redis.smembers(key))
    except Exception as e:
        logger.warning("[proactive] dismissed 조회 실패 — 빈 목록으로 진행: %s", e)
        return set()


def _dismiss_member(candidate: dict) -> str:
    place_id = candidate["params"].get("placeId")
    return f"{candidate['type']}:{place_id if place_id else '-'}"
```

`get_intervention`(:511-523):

```python
    candidates = [c for c in (rule(snap) for rule in rules) if c is not None]
    dismissed = await _load_dismissed(redis, user_id, route_id, now)
    candidates = [c for c in candidates if _dismiss_member(c) not in dismissed]
    return _select(candidates)
```

> `_select` 자체는 건드리지 않는다. 필터링은 호출부에서 하고 `_select`는
> "후보 중 하나를 고른다"는 단일 책임을 유지한다 — 나중에 LLM 호출로 교체한다는 기존 주석의 전제도 지켜진다.

### Step 3 — `_load_slots`에 `p.id` 추가

`proactive_service.py:343-355`. 지금 places에서 뽑는 건 `name`, `category_tags` 둘뿐이다.
**Phase C에서 운영정보 컬럼을 추가할 때 같은 자리에 넣으므로, 여기선 `p.id AS place_id`만 추가**한다.

⚠️ `:344-348` 주석이 **`start_time IS NOT NULL` 필터를 넣지 말 것**을 명시하고 있다. 건드리지 마라.

### Step 4 — 프론트

`frontend/lib/proactiveDismissal.ts`
- 키를 `proactive:{routeId}:{type}:{placeId ?? '-'}:{날짜}`로 확장
- 날짜를 **KST 기준**으로 계산 (기존 `toLocalDateString(new Date())`는 기기 로컬이라 서버와 어긋난다)
- MMKV는 **즉시 UX 레이어로만** 남긴다 — refetch를 기다리지 않고 바로 숨기는 용도. 진실은 서버

`frontend/lib/api/proactive.ts` — `sendProactiveFeedback(routeId, type, action, placeId?)`

**소비처 2곳을 반드시 함께 고친다**:
- `components/route/ProactiveBanner.tsx:25` (렌더 가드), `:32` handleTap, `:39` handleDismiss
- `app/(tabs)/chat.tsx:247-249` (챗봇 자동 개입 가드)

### Step 5 — 덤: 배너 X 미소멸 (`unimplemented.md:382-388`)

`handleDismiss`가 `dismissToday`(MMKV 쓰기)와 `sendProactiveFeedback`(fire-and-forget)만 호출해
**React 상태·쿼리 캐시를 안 건드려 리렌더가 안 난다.** `isDismissedToday` 검사는 렌더 시점에만 도니까
X를 눌러도 배너가 남고, 다시 탭하면 같은 말풍선이 챗봇에 중복으로 쌓인다.

```tsx
queryClient.setQueryData(['proactive', routeId], null);
```

배너와 챗봇이 같은 키 `['proactive', routeId]`를 공유하므로 한 번에 해결된다. 어차피 이 파일을 여는 김에 처리.

---

## B-2. `V23__create_place_closures.sql`

### 왜 필요한가

V21의 `closed_weekdays SMALLINT[]`로는 **표현할 수 없는 휴관 규칙이 다수**다:

| 기관 | 휴관 규칙 | 요일 배열로 표현? |
|---|---|---|
| 창경·창덕·덕수궁 | 월요일 | ✅ |
| 경복궁·남산골 | 화요일 | ✅ |
| 국립중앙박물관 | 요일 휴관 **없음**. 2026년 휴관일 = 6/1·9/7·12/7 | ❌ |
| 국립고궁박물관 | 1/1·설날·추석 + "매월 마지막 월요일" | ❌ |

### 스키마

```sql
-- ============================================================
-- V23: place_closures — 요일 규칙으로 표현 안 되는 휴관을 날짜로 직접 적재
-- ============================================================
-- 왜: closed_weekdays(V21)는 "매주 월요일"만 표현한다. 실제로는 특정 날짜 3개만
--     닫는 박물관, "매월 마지막 월요일"인 곳이 흔하다. 요일 규칙과 날짜 예외를
--     OR로 판정한다.
--
-- 설계 판단
--  1) 공휴일 캘린더(holidays)와 대체휴관 판정 로직은 만들지 않는다. 대체휴관은
--     "정기휴일이 공휴일과 겹치면 개방하고 그다음 첫 비공휴일이 휴일"처럼 기관별
--     정책이라 코드로 일반화할 수 없다. 기관 공지에 실제 날짜가 나오므로 그걸 넣는다.
--  2) updated_at·트리거를 두지 않는다. 이 테이블은 INSERT/DELETE만 있고 UPDATE가 없다
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
```

### 범위 밖

V21의 `closed_on_holidays BOOLEAN` 컬럼은 **이번에 쓰지 않는다.**
공휴일 캘린더를 만들지 않기로 했으므로 "오늘이 공휴일인가"를 판정할 소스가 없다.
컬럼은 남겨두고 규칙에서 참조하지 않는다.

---

## B-3. 큐레이션 서울 30~50곳 시드

### 왜 필요한가

V21로 스키마 18컬럼이 준비됐지만 **그 컬럼을 채우는 코드가 리포 어디에도 없다.**
값이 없으면 규칙 6종 중 5종이 NULL 가드에 걸려 **개입 자체를 안 만든다** — 코드가 맞아도 화면엔 아무것도 안 뜬다.

### 숨은 블로커 — `business_hours`

`last_entry_minutes`는 "폐장 N분 전"이라는 **상대값**이다.
`places.business_hours`(V2)는 선언만 돼 있고 값을 넣는 코드가 없어서 **폐장 절대시각을 만들 수 없다.**
→ 시드에 `business_hours`를 반드시 포함한다.

### JSONB 형식 (확정)

Notion 재점검이 "입력 전 확정 필수"로 남긴 건이다. 30~50곳 넣고 바꾸면 전부 재입력이라 여기서 못박는다.

```jsonc
// business_hours
{"open": "09:00", "close": "18:00",
 "weekday_overrides": {"6": {"open": "10:00", "close": "22:00"}}}   // 선택, ISO 1=월…7=일

// break_time
{"start": "15:00", "end": "17:00", "except_weekdays": [6, 7]}       // 선택
```

둘 다 부가 필드가 **선택**이라 단순한 집은 기존 표기 그대로 쓴다.

### 산출물

**`ai/scripts/data/operational_info.csv`** — 사람이 채우는 입력 파일

```
name,address,open,close,weekday_overrides,break_start,break_end,break_except_weekdays,
last_order_minutes,last_entry_minutes,reservation_required,walk_in_allowed,
reservation_platform,cash_only,friendly_foreign_card,closed_weekdays,closures
```

- `closed_weekdays` — `1;2` 형식(세미콜론 구분, ISO 1=월…7=일)
- `closures` — `2026-06-01:정기휴관;2026-09-07:시설점검` 형식 → `place_closures`로 적재
- **빈 칸은 NULL.** 0으로 채우지 마라

**`ai/scripts/seed_operational_info.py`** — 적재 스크립트

기존 수집 스크립트(`collect_kakao.py`, `collect_naver_local.py`)의 asyncpg 사용 패턴을 따른다.

- place_id는 **이름 + 주소로 조회해서 해결**한다. CSV에 UUID를 손으로 적게 하지 않는다
  (`PlaceRepository.findNearbyPlaceIdByName`의 find-or-create 발상과 동일)
- 매칭 실패한 행은 **건너뛰고 목록을 출력**한다. 조용히 무시하지 마라
- places 운영정보는 UPDATE, `place_closures`는 `ON CONFLICT DO NOTHING` — 재실행 멱등
- `last_entry_minutes`가 있는데 `business_hours`가 비면 **경고 출력** (FFE #8)
- 빈 문자열 → `None`으로 변환하는 헬퍼를 두고 전 컬럼에 일괄 적용 (FFE #6)

---

## 검증 방법

```bash
# B-2 마이그레이션
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
# 기대: Flyway "Migrating schema public to version 23 - create place closures"

# B-3 시드 (멱등성 확인 — 두 번 돌린다)
cd ai && python scripts/seed_operational_info.py
python scripts/seed_operational_info.py
psql -h localhost -p 5433 -U cloumy -d cloumy -c \
  "SELECT count(*) FROM places WHERE business_hours IS NOT NULL;
   SELECT count(*) FROM place_closures;"
# 기대: 두 번째 실행에서도 건수 동일, 에러 없음

# B-1 dismiss — 서버 기록 확인
curl -X POST localhost:8080/v1/routes/$ROUTE_ID/proactive/feedback \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"WEATHER_ALERT","action":"dismissed"}'
redis-cli SMEMBERS "proactive:dismissed:$USER_ID:$ROUTE_ID:$(TZ=Asia/Seoul date +%F)"
# 기대: "WEATHER_ALERT:-"
redis-cli TTL "proactive:dismissed:$USER_ID:$ROUTE_ID:$(TZ=Asia/Seoul date +%F)"
# 기대: 172800 이하의 양수

# B-1 필터링 — 닫은 개입이 서버에서 걸러지는지
curl localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"
# 기대: 방금 닫은 WEATHER_ALERT가 아니라 그다음 우선순위 개입 (또는 null)

# B-1 fail-open
docker stop $(docker ps -qf name=redis)
curl localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"
# 기대: 500이 아니라 정상 응답 (dismiss 필터만 무력화)
docker start $(docker ps -aqf name=redis)
```

---

## 체크리스트

**B-1**
- [ ] Spring·FastAPI·프론트가 **모두 KST 날짜**로 같은 키를 만든다
- [ ] 장소 무관 규칙 멤버가 `{TYPE}:-` (문자열 `"null"` 아님)
- [ ] A개입을 닫은 뒤 **B개입이 그날 안에 뜬다** ← L2 해소를 확인하는 핵심 시나리오
- [ ] 같은 장소·같은 규칙은 그날 다시 안 뜬다
- [ ] X 누르면 배너가 **즉시** 사라진다
- [ ] Redis 중지 상태에서 개입 조회가 정상 (dismiss만 무력화)
- [ ] `_load_slots`의 `start_time IS NOT NULL` 금지 주석을 어기지 않았다

**B-2**
- [ ] V23 적용 후 `\d place_closures` 정상
- [ ] `closed_on_holidays`는 건드리지 않았다

**B-3**
- [ ] CSV 빈 칸이 **NULL**로 들어갔다 (0 아님)
- [ ] `business_hours`가 채워진 곳 수 == `last_entry_minutes`가 채워진 곳 수 이상
- [ ] 두 번 실행해도 결과 동일 (멱등)
- [ ] 이름 매칭 실패한 행이 목록으로 출력된다

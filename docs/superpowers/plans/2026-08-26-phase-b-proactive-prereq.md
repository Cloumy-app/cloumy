# Phase B — 프로액티브 선행 조건 3건

> **스택**: 공통(Spring + FastAPI + Frontend) · DB
> **참조 전문가 스킬**: `fastapi-expert` · `postgres-expert` · `spring-expert` · `frontend-expert` · `karpathy-guidelines`
> **노션**: [🚀 출시 최소범위 마무리](https://app.notion.com/p/3c83c69447de811aab85ddc189ee7609)
> **선행**: 없음 (Phase A와 독립)
> **후행**: Phase C 규칙 6종이 이 세 건에 전부 막혀 있다

**나중에 하면 서버·프론트·params 계약을 동시에 뒤집어야 한다.** 그래서 규칙보다 먼저 한다.

---

## 작업 분할 (병렬 가능 단위)

| 팩 | 범위 | 파일 겹침 | 병렬 |
|---|---|---|---|
| **P1** | B-1 서버 — Spring 기록 + FastAPI 필터링 | backend/, ai/ | P2와 병렬 |
| **P2** | B-1 프론트 — 키 확장 + 배너 즉시 소멸 | frontend/ | P1과 병렬 |
| **P3** | B-2 V23 + B-3 시드 스크립트·CSV | backend/db, ai/scripts/ | P1·P2와 병렬 |

세 팩이 파일을 공유하지 않는다. 다만 **P1·P2는 계약(`placeId` 필드)이 맞아야 하므로 아래 계약을 먼저 고정한다.**

### 고정 계약 (세 팩 공통)

```
Redis KEY     proactive:dismissed:{userId}:{routeId}:{yyyy-MM-dd}     ← 날짜는 KST
     MEMBER   "{TYPE}:{placeId}"    장소 단위 규칙 (Phase C의 신규 6종)
              "{TYPE}:-"            장소 무관 규칙 (기존 9종)
     TTL      48h

HTTP  POST /v1/routes/{routeId}/proactive/feedback
      { "type": "...", "action": "dismissed", "placeId": "uuid | null" }

MMKV  proactive:{routeId}:{type}:{placeId ?? '-'}:{yyyy-MM-dd}         ← 날짜는 KST
```

⚠️ **`placeId`가 없을 때 문자열 `"null"`/`"undefined"`가 새어들어가지 않게 할 것.** 반드시 `-`.

---

## 실패 시나리오 (FFE)

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | 서버·클라이언트 날짜가 어긋난다 | 자정 근처에 dismiss가 안 먹거나 하루 일찍 풀림 | **KST 고정.** 도커 컨테이너는 UTC라 `LocalDate.now()`만 쓰면 자정 근처에 하루 어긋난다 — `RouteService.java:263-264`가 같은 이유로 이미 `ZoneId.of("Asia/Seoul")`을 명시하고 있다. 프론트는 `Intl` 대신 UTC+9 산술로 계산(Hermes의 `Intl` timeZone 지원이 플랫폼마다 다르다, KST는 DST 없음) |
| 2 | Redis 장애로 dismiss **기록** 실패 | `RedisConnectionFailureException` | **fail-open** — 최악이 "닫은 배너가 다시 뜬다"라 개입 조회를 막을 이유가 없다. Phase A에서 넣은 `timeout: 1s` 덕에 1초 안에 떨어진다 |
| 3 | Redis 장애로 dismissed **조회** 실패 | `redis.exceptions.RedisError` | **fail-open** — 빈 set으로 간주. `_build_snapshot`의 날씨 조회가 이미 같은 정책이다 |
| 4 | `_select` 앞이 아니라 뒤에서 필터링 | 후보가 1개로 좁혀진 뒤 걸러져 **아무것도 안 뜬다** | **반드시 `_select` 호출 전에 candidates를 거른다.** 이게 L2 해소의 전부다 |
| 5 | 프론트가 `placeId`를 params에서 못 꺼낸다 | 타입 에러 또는 항상 `-` | `ProactiveIntervention`은 판별 유니온이고 기존 9종 params에 `placeId`가 없다. `'placeId' in i.params` 좁히기로 꺼낸다 — Phase C에서 필드를 추가해도 그대로 동작 |
| 6 | 시드 CSV 빈 칸이 0으로 들어간다 | — | **NULL = 미조사, 0 = 조사했는데 없음.** 0으로 채우면 챗봇이 "이 집은 영어메뉴 없어요"라고 단정한다. V21 마이그레이션 주석이 이 규약을 명시하고 있다 |
| 7 | 시드 재실행 시 중복 | PK 위반 | places는 UPDATE, `place_closures`는 `ON CONFLICT DO NOTHING` — 멱등 |
| 8 | `business_hours` 없이 `last_entry_minutes`만 채운다 | `LAST_ENTRY`가 조용히 안 뜸 | 시드 스크립트가 **경고를 출력**한다. `last_entry_minutes`는 "폐장 N분 전"이라는 상대값이라 폐장 절대시각이 없으면 규칙이 성립하지 않는다 |
| 9 | 이름 매칭 실패한 CSV 행을 조용히 버린다 | 데이터가 일부만 들어감 | 실패 행을 **목록으로 출력**하고 종료 코드로 알린다 |

---

# P1 — B-1 서버 (Spring 기록 + FastAPI 필터링)

## 왜 서버여야 하는가

`_select`(`proactive_service.py:330-336`)는 `min(priority)` **1개만** 반환한다.
기존 9종은 전부 시간창 기반이라 자연 소멸하지만(`0 <= minutes_left <= 60`),
Phase C의 `CLOSED_DAY`·`PAYMENT_WALL`·`RESERVATION_WALL`은 **상태 기반이라 하루 종일 참**이다.
한 번 걸리면 유저가 닫아도 서버는 계속 같은 걸 뱉는다 → **그날 나머지 개입 전멸.**
프론트 필터만으로는 구조적으로 못 막는다.

## Step 1 — `ProactiveFeedbackRequest.java`

```java
public record ProactiveFeedbackRequest(
        @NotBlank @Pattern(regexp = ProactiveIntervention.TYPE_PATTERN) String type,
        @NotBlank @Pattern(regexp = "tapped|dismissed|auto_shown") String action,
        // Phase C의 신규 6종은 전부 장소 단위라 같은 type이어도 장소가 다르면 별개로 닫혀야 한다.
        // 장소 무관 규칙(기존 9종)은 null.
        UUID placeId
) {}
```

기존 파일 상단 주석 *"계측용 — DB 저장 없이 로그만 남긴다"* 는 **더 이상 사실이 아니다.** 함께 고칠 것.

## Step 2 — `ProactiveController.java`

`StringRedisTemplate` 주입 추가(현재 필드는 `RouteRepository`, `AiServiceClient` 둘뿐).
전용 서비스 계층은 만들지 않는다 — 이 컨트롤러는 원래 서비스 없이 `AiServiceClient`를 직접 쓰는 구조다.

```java
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration DISMISS_TTL = Duration.ofHours(48);
```

`feedback` 메서드 `:53`의 `log.info`는 그대로 두고 뒤에 추가:

```java
        if ("dismissed".equals(req.action())) {
            recordDismissal(userId, routeId, req);
        }
```

```java
    // 프론트 MMKV만으론 못 막는다 — _select가 priority 최솟값 1개만 반환하는데 상태형 규칙
    // (CLOSED_DAY 등)은 하루 종일 참이라, 서버가 안 걸러주면 유저가 닫은 개입 하나가
    // 그날 나머지 개입을 전부 가린다.
    private void recordDismissal(UUID userId, UUID routeId, ProactiveFeedbackRequest req) {
        // 도커 컨테이너는 UTC라 LocalDate.now()만 쓰면 자정 근처에 FastAPI(_KST)와 하루 어긋난다
        // (RouteService.java:263-264와 같은 이유).
        String key = "proactive:dismissed:%s:%s:%s"
                .formatted(userId, routeId, LocalDate.now(KST));
        String member = req.type() + ":" + (req.placeId() != null ? req.placeId() : "-");
        try {
            redisTemplate.opsForSet().add(key, member);
            redisTemplate.expire(key, DISMISS_TTL);
        } catch (Exception e) {
            // fail-open — 최악이 "닫은 배너가 다시 뜬다"라 개입 조회를 막을 이유가 없다
            log.warn("dismiss 기록 실패 — 무시: {}", e.getMessage());
        }
    }
```

## Step 3 — `proactive_service.py` 필터링

```python
_DISMISS_TTL_HOURS = 48  # Spring ProactiveController와 맞춘 값(기록은 Spring이 한다)


async def _load_dismissed(redis, user_id: str, route_id: str, now: datetime) -> set[str]:
    """오늘 유저가 닫은 개입 목록. Redis 장애 시 빈 set — 개입을 막지 않는다(FFE #3)."""
    key = f"proactive:dismissed:{user_id}:{route_id}:{now.date().isoformat()}"
    try:
        return set(await redis.smembers(key))
    except Exception as e:
        logger.warning("[proactive] dismissed 조회 실패 — 빈 목록으로 진행: %s", e)
        return set()


def _dismiss_member(candidate: dict) -> str:
    """Spring이 기록하는 멤버 형식과 1:1로 맞춘다 — 장소 무관 규칙은 '-'."""
    place_id = candidate["params"].get("placeId")
    return f"{candidate['type']}:{place_id or '-'}"
```

`get_intervention`(`:511-523`):

```python
    candidates = [c for c in (rule(snap) for rule in rules) if c is not None]
    dismissed = await _load_dismissed(redis, user_id, route_id, now)
    candidates = [c for c in candidates if _dismiss_member(c) not in dismissed]   # ← _select 앞!
    return _select(candidates)
```

> `_select` 자체는 건드리지 않는다. "후보 중 하나를 고른다"는 단일 책임을 유지해야
> *"후보가 여러 개 뜨기 시작하면 이 함수만 LLM 호출로 교체한다"*는 기존 주석의 전제가 지켜진다.

## Step 4 — `_load_slots`에 `p.id` 추가

`proactive_service.py:343-355`. SELECT에 `p.id AS place_id`만 추가한다
(운영정보 컬럼은 Phase C에서 같은 자리에 넣는다).

⚠️ `:344-348`의 긴 주석이 **`start_time IS NOT NULL` 필터 금지**를 못박고 있다. 건드리지 마라.

## ⚠️ Phase C 인계 사항 — `placeId`는 반드시 `str()`로 넣을 것

`_load_slots`가 뽑는 `p.id`는 asyncpg가 **`uuid.UUID` 객체**로 준다.
Phase C에서 규칙 함수가 이걸 그대로 `params["placeId"]`에 넣으면 두 곳에서 깨진다:

1. `get_intervention`의 반환값은 FastAPI가 JSON으로 직렬화하는데 **`uuid.UUID`는 기본 직렬화가 안 된다**
2. Spring이 기록하는 멤버는 `UUID.toString()`(소문자 하이픈)인데, 파이썬 쪽이 다른 표기를 내면
   `_dismiss_member`가 만든 문자열이 Redis 멤버와 안 맞아 **필터가 조용히 무력화된다**

→ 규칙 함수에서 `"placeId": str(slot["place_id"])`로 넣는다.

## Step 5 — 테스트

`ai/tests/test_proactive_rules.py`에 추가. 기존 파일이 **DB·네트워크 목킹 없이 dict 스냅샷으로
순수 함수를 검증**하는 구조라 `_dismiss_member`는 그대로 단위 테스트할 수 있다.

- `_dismiss_member`가 placeId 있을 때 `"TYPE:uuid"`, 없을 때 `"TYPE:-"`
- `params`에 `placeId: None`이 명시돼도 `"TYPE:-"` (FFE — 문자열 `"None"` 금지)

---

# P2 — B-1 프론트 (키 확장 + 배너 즉시 소멸)

## Step 1 — `lib/proactiveDismissal.ts`

```ts
// 프로액티브 배너 중복 노출 방지. 서버(Redis)가 진실이고 이 MMKV는 즉시 UX 레이어다 —
// refetch를 기다리지 않고 바로 숨기기 위한 것.
// 키: proactive:{routeId}:{type}:{placeId ?? '-'}:{YYYY-MM-DD}

// 서버(Spring LocalDate.now(KST), FastAPI datetime.now(_KST))와 같은 날짜를 써야 한다.
// Intl의 timeZone 지원이 Hermes 플랫폼마다 달라 UTC+9 산술로 계산한다(KST는 DST 없음).
function toKstDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dismissalKey(routeId: string, type: string, placeId?: string): string {
  return `proactive:${routeId}:${type}:${placeId ?? '-'}:${toKstDateString()}`;
}

export function isDismissedToday(routeId: string, type: string, placeId?: string): boolean { ... }
export function dismissToday(routeId: string, type: string, placeId?: string): void { ... }
```

기존 `toLocalDateString`(`:7-12`)은 **삭제한다** — 기기 로컬 날짜라 서버와 어긋나는 원인이다.

## Step 2 — placeId 추출 헬퍼

기존 9종 params에는 `placeId`가 없다. 판별 유니온을 좁혀서 꺼낸다:

```ts
// Phase C의 신규 6종만 params.placeId를 갖는다. 기존 9종은 undefined —
// 'in' 좁히기라 Phase C에서 필드를 추가해도 그대로 동작한다.
export function interventionPlaceId(i: ProactiveIntervention): string | undefined {
  return 'placeId' in i.params ? (i.params.placeId as string | undefined) : undefined;
}
```

`lib/proactiveText.ts` 옆(`lib/proactiveDismissal.ts`)에 둔다 — 소비처가 배너·챗봇 둘이다.

## Step 3 — `lib/api/proactive.ts`

`sendProactiveFeedback(routeId, type, action, placeId?)` — body에 `placeId`를 함께 싣는다.
파일 상단 주석 *"DB 저장 없이 로그만 남기는 엔드포인트"* 도 고칠 것(이제 dismiss는 서버에 남는다).

## Step 4 — `components/route/ProactiveBanner.tsx`

`:25` 렌더 가드, `:32` `handleTap`, `:39` `handleDismiss` 세 곳 모두 `placeId`를 넘긴다.

**그리고 배너 즉시 소멸**(`unimplemented.md:382-388`) — 지금 `handleDismiss`가
`dismissToday`(MMKV 쓰기)와 `sendProactiveFeedback`(fire-and-forget)만 호출해
**React 상태·쿼리 캐시를 안 건드려 리렌더가 안 난다.** `isDismissedToday` 검사는 렌더 시점에만
돌기 때문에 X를 눌러도 배너가 남고, 다시 탭하면 같은 말풍선이 챗봇에 중복으로 쌓인다.

```tsx
const queryClient = useQueryClient();
...
  const handleDismiss = () => {
    dismissToday(routeId, intervention.type, placeId);
    sendProactiveFeedback(routeId, intervention.type, 'dismissed', placeId);
    // MMKV 쓰기만으론 리렌더가 안 나 배너가 화면에 남는다. 배너와 챗봇이 같은 키를
    // 공유하므로 캐시를 비우면 양쪽이 함께 정리된다.
    queryClient.setQueryData(['proactive', routeId], null);
  };
```

## Step 5 — `app/(tabs)/chat.tsx` (`:247-249`)

자동 개입 가드도 `placeId`를 넘긴다. 배너와 **같은 키**를 써야 한다 —
배너 탭으로 들어온 경우를 챗봇이 걸러내는 게 이 공유 키에 의존한다(`:245-246` 주석).

## 완료 조건

`npx tsc --noEmit --ignoreDeprecations 6.0` 통과 (⚠️ `tsconfig.json`의 `baseUrl` 폐기 경고는
리포 기존 이슈다 — 플래그 없이 돌리면 그 경고 때문에 실패한다).

---

# P3 — B-2 마이그레이션 + B-3 시드

## B-2 — `V23__create_place_closures.sql`

V21의 `closed_weekdays SMALLINT[]`로는 표현할 수 없는 휴관이 다수다:

| 기관 | 휴관 규칙 | 요일 배열? |
|---|---|---|
| 창경·창덕·덕수궁 | 월요일 | ✅ |
| 경복궁·남산골 | 화요일 | ✅ |
| 국립중앙박물관 | 요일 휴관 **없음**. 2026년 = 6/1·9/7·12/7 | ❌ |
| 국립고궁박물관 | 1/1·설날·추석 + "매월 마지막 월요일" | ❌ |

```sql
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
```

⚠️ V21의 `closed_on_holidays BOOLEAN`은 **이번에 쓰지 않는다.** 공휴일 캘린더를 안 만들기로 했으므로
"오늘이 공휴일인가"를 판정할 소스가 없다. 컬럼은 남겨두고 규칙에서 참조하지 않는다.

## B-3 — 시드

### 숨은 블로커: `business_hours`

`last_entry_minutes`는 "폐장 N분 전"이라는 **상대값**이다. `places.business_hours`(V2)는
선언만 돼 있고 **값을 넣는 코드가 리포 어디에도 없어서** 폐장 절대시각을 만들 수 없다.
→ 시드에 반드시 포함한다.

### JSONB 형식 (확정 — 입력 전에 못박는다)

```jsonc
// business_hours
{"open": "09:00", "close": "18:00",
 "weekday_overrides": {"6": {"open": "10:00", "close": "22:00"}}}   // 선택, ISO 1=월…7=일

// break_time
{"start": "15:00", "end": "17:00", "except_weekdays": [6, 7]}       // 선택
```

부가 필드가 **선택**이라 단순한 집은 기존 표기 그대로 쓴다.
30~50곳을 넣은 뒤 형식을 바꾸면 전부 재입력이라 여기서 확정한다.

### `ai/scripts/data/operational_info.csv`

사람이 채우는 입력 파일. 헤더:

```
name,address,open,close,weekday_overrides,break_start,break_end,break_except_weekdays,
last_order_minutes,last_entry_minutes,reservation_required,walk_in_allowed,
reservation_platform,cash_only,friendly_foreign_card,closed_weekdays,closures
```

- `closed_weekdays` — `1;2` (세미콜론 구분, ISO 1=월…7=일)
- `closures` — `2026-06-01:정기휴관;2026-09-07:시설점검`
- `weekday_overrides` — `6:10:00-22:00;7:10:00-18:00`
- `reservation_platform` — `catchtable_global|catchtable|naver|tabling|phone|none` (V21 CHECK)
- **빈 칸은 NULL.** 0으로 채우지 마라

서울 30~50곳을 미리 채워 넣지 말고 **헤더 + 예시 2~3행**만 만든다. 실제 조사는 사용자 몫이다.

### `ai/scripts/seed_operational_info.py`

`collect_naver_local.py` 스타일을 따른다 — `#!/usr/bin/env python3`, 실행 예시가 든 docstring,
`argparse`, `asyncio`, `logging.basicConfig`, `load_dotenv(Path(__file__).parent.parent / ".env")`,
`from app.config.database import create_pool`, 실행은 `python -m scripts.seed_operational_info`.

- `--dry-run` 지원 (기존 수집기 관례)
- **place_id는 이름 + 주소로 조회해 해결한다.** CSV에 UUID를 손으로 적게 하지 않는다
  (`PlaceRepository.findNearbyPlaceIdByName`의 find-or-create 발상과 동일)
- 매칭 실패 행은 **건너뛰고 목록 출력** (FFE #9)
- 빈 문자열 → `None` 변환 헬퍼를 만들어 전 컬럼에 일괄 적용 (FFE #6)
- places는 UPDATE, `place_closures`는 `ON CONFLICT DO NOTHING` (FFE #7)
- `last_entry_minutes`가 있는데 `business_hours`가 비면 **경고 출력** (FFE #8)

---

## 검증 방법

```bash
# 사전 — Redis·Postgres 기동 확인
docker compose up -d postgres redis

# B-2 마이그레이션
docker compose up -d --build spring
docker logs cloumy-spring-1 2>&1 | grep "version \"23"
# 기대: Migrating schema "public" to version "23 - create place closures"
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c '\d place_closures'

# B-3 시드 (멱등성 — 두 번 돌린다)
cd ai && python -m scripts.seed_operational_info --dry-run
python -m scripts.seed_operational_info
python -m scripts.seed_operational_info
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c \
  "SELECT count(*) FILTER (WHERE business_hours IS NOT NULL) AS hours,
          count(*) FILTER (WHERE last_entry_minutes IS NOT NULL) AS last_entry
   FROM places;"
# 기대: 두 번째 실행에서도 건수 동일. hours >= last_entry (FFE #8)

# B-1 기록
TOKEN=$(curl -s -X POST localhost:8080/v1/dev/token | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -X POST localhost:8080/v1/routes/$ROUTE_ID/proactive/feedback \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"WEATHER_ALERT","action":"dismissed"}'
docker exec cloumy-redis-1 redis-cli SMEMBERS \
  "proactive:dismissed:$USER_ID:$ROUTE_ID:$(TZ=Asia/Seoul date +%F)"
# 기대: "WEATHER_ALERT:-"   ← "WEATHER_ALERT:null" 이면 FFE 위반
docker exec cloumy-redis-1 redis-cli TTL "proactive:dismissed:$USER_ID:$ROUTE_ID:$(TZ=Asia/Seoul date +%F)"
# 기대: 172800 이하 양수

# B-1 필터링 — 핵심 시나리오
curl localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"
# 기대: 방금 닫은 WEATHER_ALERT가 아니라 그다음 우선순위 개입 (또는 null)

# B-1 fail-open
docker stop cloumy-redis-1
curl -s -o /dev/null -w 'HTTP %{http_code} %{time_total}초\n' \
  localhost:8080/v1/routes/$ROUTE_ID/proactive -H "Authorization: Bearer $TOKEN"
# 기대: 200, 1초대 (Phase A의 timeout: 1s 덕분)
docker start cloumy-redis-1

# 테스트
cd ai && pytest tests/test_proactive_rules.py -q
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0
```

---

## 체크리스트

**P1 (서버)**
- [ ] 필터링이 **`_select` 호출 전**에 있다 (FFE #4 — 뒤에 두면 아무것도 안 뜬다)
- [ ] `catch (Exception e)`가 fail-open, 로그는 `RateLimitFilter` 톤
- [ ] Spring `LocalDate.now(ZoneId.of("Asia/Seoul"))` — `LocalDate.now()` 아님
- [ ] 장소 무관 규칙 멤버가 `"{TYPE}:-"` (`"null"`/`"None"` 아님)
- [ ] `_load_slots`의 `start_time IS NOT NULL` 금지 주석을 어기지 않았다
- [ ] `ProactiveFeedbackRequest`·`lib/api/proactive.ts`의 "로그만 남긴다" 주석을 갱신했다

**P2 (프론트)**
- [ ] `toLocalDateString` 삭제, KST 계산으로 대체
- [ ] 소비처 **2곳** 모두 갱신 — `ProactiveBanner.tsx`, `chat.tsx`
- [ ] X 누르면 배너가 **즉시** 사라진다
- [ ] `tsc --noEmit --ignoreDeprecations 6.0` 통과

**P3 (DB·시드)**
- [ ] V23 적용 후 `\d place_closures` 정상
- [ ] `closed_on_holidays`는 건드리지 않았다
- [ ] CSV 빈 칸이 **NULL**로 들어갔다 (0 아님)
- [ ] 두 번 실행해도 결과 동일
- [ ] 이름 매칭 실패 행이 목록으로 출력된다
- [ ] CSV는 헤더 + 예시 몇 행만 (실제 30~50곳 조사는 사용자 몫)

**통합 (P1+P2 합류 후)**
- [ ] A장소 개입을 닫은 뒤 **B장소의 다른 개입이 그날 안에 뜬다** ← L2 해소 확인의 핵심
- [ ] 같은 장소·같은 규칙은 그날 다시 안 뜬다
- [ ] Redis 중지 상태에서 개입 조회가 1초대 정상 응답

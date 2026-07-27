# 구현 계획: 프로액티브 개입 엔진 (#143)

**스택**: FastAPI(주) · Spring · Frontend · DB
**설계 문서**: `docs/superpowers/specs/2026-07-27-proactive-chatbot-design.md`
**참조 전문가 스킬**: `fastapi-expert`, `karpathy-guidelines`
**예상 파일 수**: 신규 8 · 수정 8

---

## 설계 문서 정정 사항

구현 계획을 세우며 발견한 것. 설계 문서도 같이 고쳐야 한다.

| 설계 문서 | 문제 | 정정 |
|---|---|---|
| P1 "숙소에서 먼 밤 일정 — 이동시간 ≥ 40분" | 숙소↔슬롯 **이동시간이 저장돼 있지 않다.** `transport_minutes`는 슬롯 간 값이고, 숙소까지는 외부 API를 불러야 계산된다 | **PostGIS 직선거리 ≥ 8km** 로 변경. 근사치로 충분하다(경고가 목적이지 정확한 안내가 아니다) |

---

## 전제 조건

- Docker(PostgreSQL·Redis) 기동 — 현재 데몬이 꺼져 있어 `docker compose up -d` 필요
- `OPENWEATHERMAP_API_KEY` 설정돼 있어야 날씨 규칙 동작 (없으면 해당 규칙만 조용히 스킵)
- 브랜치 `feat/143-proactive-intervention-engine` (생성 완료)

**재사용할 기존 구현:**

| 재사용 대상 | 위치 | 용도 |
|---|---|---|
| `_estimate_current_slot()` | `ai/app/services/chat_service.py:138` | GPS 없는 현재 슬롯 추정 — 그대로 import |
| `_load_route()` / `RouteNotFoundError` | `chat_service.py:123` | 소유권 검증 포함 루트 조회 — `departure_at` 추가해서 공유 |
| `_get_forecast_by_block()` | `ai/app/services/weather_service.py` | 강수 블록 집계 |
| `AiServiceClient.chat()` 패턴 | `backend/.../AiServiceClient.java:185` | HttpClient + `X-Internal-Key` + 타임아웃 |
| `ChatController` 소유권 검증 | `backend/.../ChatController.java:40` | `findById` → `userId` 비교 |
| `RateLimitFilter.RULES` | `backend/.../RateLimitFilter.java:37` | 경로별 한도 배열 |

---

## FFE — 실패 시나리오와 대응

### 대원칙

> **프로액티브는 부가 기능이다. 어떤 실패도 앱의 주 흐름을 막아선 안 된다.**

배너가 안 뜨는 것은 허용되는 실패다. 배너 때문에 루트 화면이 안 뜨거나 에러 토스트가 보이는 것은 허용되지 않는다. **모든 실패는 fail-silent — "개입 없음"으로 수렴한다.**

### 시나리오 표

| # | 실패 상황 | 감지 방법 | 대응 |
|---|---|---|---|
| 1 | **여행 기간 밖 유저가 앱 실행** | `_trip_phase()` 가 `out_of_range` | **쿼리 1개로 즉시 `None` 반환.** 비용 방어의 핵심 |
| 2 | OpenWeatherMap 장애·키 미설정 | `httpx` 예외 / `api_key` 빈 문자열 | 날씨 의존 규칙(P1 날씨·T4)만 스킵, 나머지는 평가 계속 |
| 3 | Redis 다운 | `redis.get/setex` 예외 | 캐시 미스로 간주하고 API 직접 호출 (**fail-open** — `_load_history()` 기존 패턴과 동일) |
| 4 | route 없음 / 타인 소유 | `RouteNotFoundError` | FastAPI 404 → Spring `ROUTE_NOT_FOUND` (챗봇과 동일) |
| 5 | `departure_at` NULL (미입력) | `route["departure_at"] is None` | T1만 스킵. 선택 입력이므로 정상 경로 |
| 6 | `budget_settings` 없음 | 조회 결과 0건 | T5만 스킵 |
| 7 | 숙소 미입력 | `accommodations` 0건 | P1의 `far_from_stay` 진단만 스킵 |
| 8 | `route_slots.start_time` 이 NULL | 조회 시 필터 | 시간 의존 규칙(T2·T7) 스킵. `_estimate_current_slot`도 이미 같은 방어를 한다 |
| 9 | 위치 추정 확신 낮음 | `confidence != "high"` | T2·T6·T7 스킵. T1·T3·T4·T5는 계속 평가 |
| 10 | **FastAPI 타임아웃·5xx** | `HttpTimeoutException` / status ≥ 500 | **Spring이 예외를 던지지 않고 `intervention: null` 반환.** 배너는 없어도 되는 것이라 에러로 승격하지 않는다 |
| 11 | 프론트 API 호출 실패 | TanStack Query `isError` | 배너를 그리지 않는다. **토스트·Alert 금지** |
| 12 | 여러 규칙이 동시에 해당 | 후보 배열 길이 > 1 | `priority` 최솟값 1개만 반환 |
| 13 | 같은 배너가 계속 뜸 | MMKV 조회 | `{routeId}:{type}:{YYYY-MM-DD}` 키가 있으면 렌더 생략 |
| 14 | 앱 재진입 반복으로 API 폭주 | RateLimitFilter | `/v1/routes/*/proactive` 30회/분 |

**시나리오 1이 가장 중요하다.** 대부분의 유저는 대부분의 시간에 여행 중이 아니다. 여기서 조기 종료하지 않으면 앱을 열 때마다 슬롯·예산·숙소·북마크를 전부 조회하게 된다.

---

## 구현 단계

### Step 1 — `V19__add_routes_departure_at.sql` 🆕

**왜 필요한가:** T1(출국 준비)의 유일한 입력이다. 노션 시나리오 ⑥이 지금까지 불가능했던 이유가 이 데이터 부재였다.

**무엇을 구현하는가:** `routes.departure_at TIMESTAMPTZ NULL` 1개 컬럼.

```sql
BEGIN;

-- 출국 일시(선택 입력) — 프로액티브 출국 준비 알림(T1)의 기준값.
-- NULL 허용: 미입력 시 T1만 동작 안 하고 나머지 규칙은 정상.
ALTER TABLE routes ADD COLUMN departure_at TIMESTAMPTZ;

COMMIT;
```

**주의사항:**
- 인덱스 불필요 — 항상 특정 `route_id` 1건을 조회한 뒤 읽는 값이다
- `NOT NULL` 금지 — 기존 루트가 전부 깨진다

---

### Step 2 — `weather_service.py` 수정: 원본 캐시 + 온도 추출 ✏️

**왜 필요한가:** 두 가지를 동시에 푼다. ① 프로액티브가 앱 열 때마다 OpenWeatherMap을 직접 부르면 무료 한도가 터진다 ② 폭염·한파 판정에 필요한 온도가 **이미 응답에 들어 있는데 버려지고 있다**.

**무엇을 구현하는가:**
- `_fetch_forecast_raw(lat, lon, api_key, redis)` 🆕 — 원본 `list`를 Redis 캐시와 함께 반환
- `_get_forecast_by_block()` ✏️ — 위 함수를 쓰도록 변경 (반환 형식 불변)
- `_get_daily_temps(...)` 🆕 — 날짜별 `{min, max}` 집계

**어떻게 구현하는가:**

```python
_FORECAST_CACHE_TTL = 3600  # 1시간 — 3시간 간격 예보라 이보다 짧게 잡을 이유가 없다


async def _fetch_forecast_raw(
    lat: float, lon: float, api_key: str, redis=None
) -> list[dict]:
    """OpenWeatherMap /forecast 원본 list를 반환. Redis가 있으면 캐시를 경유한다.

    좌표를 소수점 2자리로 반올림해 키를 만든다 — 호출부가 CITY_CENTERS 좌표를 쓰므로
    사실상 도시당 키 1개가 된다.
    """
    key = f"weather:forecast:{lat:.2f}:{lon:.2f}"
    if redis is not None:
        try:
            cached = await redis.get(key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.warning("날씨 캐시 조회 오류 — API 직접 호출: %s", e)

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(...)  # 기존 호출 그대로
        resp.raise_for_status()
    items = resp.json().get("list", [])

    if redis is not None:
        try:
            await redis.setex(key, _FORECAST_CACHE_TTL, json.dumps(items))
        except Exception as e:
            logger.warning("날씨 캐시 저장 오류 — 캐시 없이 진행: %s", e)
    return items


def _temps_by_date(items: list[dict]) -> dict[str, dict[str, float]]:
    """날짜별 최저·최고 기온. 폭염·한파 판정용."""
    temps: dict[str, dict[str, float]] = {}
    for item in items:
        date_str = item["dt_txt"].split(" ")[0]
        t = float(item["main"]["temp"])
        day = temps.setdefault(date_str, {"min": t, "max": t})
        day["min"] = min(day["min"], t)
        day["max"] = max(day["max"], t)
    return temps
```

**주의사항:**
- **`_get_forecast_by_block()`의 시그니처에 `redis=None` 기본값으로 추가한다.** 기존 호출부(`route_service.build_weather_forecast_text`, `chat_service._tool_get_weather_forecast`)를 안 고쳐도 되고, 고치면 챗봇도 캐시 혜택을 본다
- **반환 형식을 바꾸지 말 것** — `{"날짜": {"오후": 0.8}}` 를 바꾸면 루트 생성과 챗봇이 동시에 깨진다. 온도는 별도 함수로 뽑는다
- 캐시 실패는 전부 `warning` 로그 후 진행. 캐시는 최적화지 정합성 요소가 아니다

---

### Step 3 — `ai/app/services/proactive_service.py` 🆕 (핵심)

**왜 필요한가:** 이 파일이 "지금 이 유저에게 말을 걸 것인가, 건다면 무엇을"을 결정한다. 프로액티브의 전부다.

**무엇을 구현하는가:**

```
_trip_phase(route, now)              여행 전 D-1 / 여행 중 / 범위 밖
_build_snapshot(db, redis, route)    규칙들이 볼 재료를 한 번에 모음
_rule_*(snapshot) -> dict | None     규칙 8종. 전부 순수 함수
_select(candidates) -> dict | None   후보 중 1개 선택  ← 나중에 LLM으로 교체될 지점
get_intervention(...)                진입점
```

**핵심 설계 — 규칙은 순수 함수로 만든다.**

```python
def _rule_budget_over(snap: dict) -> dict | None:
    """오늘 지출이 하루 예산의 1.2배를 넘으면 개입."""
    budget = snap.get("budget")
    if budget is None:
        return None  # 예산 미설정 — 정상 경로
    daily = budget["total"] / (snap["nights"] + 1)
    spent = snap["spent_today"]
    if spent <= daily * _BUDGET_OVER_RATIO:
        return None
    return {
        "type": "BUDGET_OVER",
        "priority": 5,
        "params": {"spentToday": spent, "dailyBudget": round(daily)},
    }
```

DB·시각·네트워크를 규칙 함수 안에서 만지지 않는다. **스냅샷 dict만 받는다.** 그래야 pytest에서 dict 하나 넣고 규칙을 단독 검증할 수 있다 — 이게 규칙 8개를 한 번에 넣어도 안전한 이유다.

**진입점 — 조기 종료가 비용 방어의 전부다.**

```python
async def get_intervention(db, redis, user_id: str, route_id: str) -> dict | None:
    route = await _load_route(db, user_id, route_id)   # 소유권 검증 포함, 404 던짐

    phase = _trip_phase(route, datetime.now(_KST))
    if phase == "out_of_range":
        return None          # ← 쿼리 1개로 종료. 대부분의 호출이 여기서 끝난다

    snap = await _build_snapshot(db, redis, route, phase)
    rules = _RULES_PRE_TRIP if phase == "pre_trip" else _RULES_DURING
    candidates = [c for c in (rule(snap) for rule in rules) if c is not None]
    return _select(candidates)


def _select(candidates: list[dict]) -> dict | None:
    """후보 중 하나를 고른다.

    지금은 priority 최솟값. 데이터가 늘어 후보가 동시에 여러 개 뜨기 시작하면
    이 함수만 LLM 호출로 교체한다 — 규칙층·API·프론트는 그대로 둔다.
    """
    return min(candidates, key=lambda c: c["priority"]) if candidates else None
```

**스냅샷 수집 — 필요한 것만 단계적으로.**

```python
async def _build_snapshot(db, redis, route, phase: str) -> dict:
    slots = await _load_slots(db, route["id"])   # places 조인, 좌표·태그·이동정보 포함
    snap = {"route": route, "slots": slots, "nights": route["nights"], ...}

    # 날씨 — 실패해도 나머지 규칙은 살린다
    try:
        snap["forecast"], snap["temps"] = await _load_weather(redis, route["destination"])
    except Exception as e:
        logger.warning("프로액티브 날씨 조회 실패 — 날씨 규칙 스킵: %s", e)
        snap["forecast"], snap["temps"] = {}, {}

    if phase == "during":
        snap["estimated"] = await _estimate_current_slot(db, route)  # chat_service 재사용
        snap["budget"], snap["spent_today"] = await _load_budget_today(db, route["id"])
        if snap["estimated"]["confidence"] == "high":
            snap["nearby_bookmarks"] = await _load_nearby_bookmarks(db, ...)  # T6 전용
    else:
        snap["stay"] = await _load_accommodations(db, route["id"])  # P1 전용
    return snap
```

북마크 조회(PostGIS)는 **위치 확신이 높을 때만** 실행한다. 확신이 낮으면 어차피 T6를 스킵하므로 쿼리가 낭비다.

**예산 조회는 1쿼리로:**

```sql
SELECT bs.total_budget,
       COALESCE(SUM(e.actual_amount) FILTER (
         WHERE (e.created_at AT TIME ZONE 'Asia/Seoul')::date = $2
       ), 0) AS spent_today
FROM budget_settings bs
LEFT JOIN expenses e ON e.route_id = bs.route_id
WHERE bs.route_id = $1
GROUP BY bs.total_budget
```

**규칙 상수는 파일 상단에 모은다** — 베타에서 조정할 값들이라 흩어져 있으면 못 찾는다.

```python
_DEPARTURE_SOON_WINDOW_MIN = 15    # T2 — 조정 예정
_BUDGET_OVER_RATIO = 1.2           # T5 — 조정 예정
_BOOKMARK_RADIUS_M = 500           # T6
_FREE_GAP_EXTRA_MIN = 60           # T7
_HEAT_C, _COLD_C = 33.0, -5.0      # P1·T4
_PACKED_SLOTS, _PACKED_TRANSPORT_MIN = 5, 180   # P1
_FAR_FROM_STAY_M = 8000            # P1 — 직선거리(이동시간 계산 불가)
_LONG_WALK_MIN = 40                # P1
_AIRPORT_MINUTES = {"서울": 90, "부산": 60, "제주": 30}   # T1, 기본 90
_CHECKIN_BUFFER_MIN = 120          # T1
```

**주의사항:**
- `_load_route()`의 SELECT에 `departure_at`을 추가해야 한다. `chat_service`가 공유하는 함수라 **컬럼 추가만** 하고 반환 형태는 건드리지 않는다
- T3(EMPTY_DAY)는 오전에만 뜨게 한다 — 저녁에 "오늘 일정 없어요"는 늦었다
- P1은 후보를 하나만 만들되 `params.flags` 배열에 진단을 담는다. 진단이 0개면 `None`(브리핑 안 뜸)
- 규칙 함수에서 `datetime.now()`를 부르지 말 것. 스냅샷의 `now`를 쓴다 — 테스트에서 시각을 고정할 수 없게 된다

---

### Step 4 — `ai/app/routes/proactive.py` 🆕

**왜 필요한가:** Spring이 호출할 입구.

```python
router = APIRouter(prefix="/ai", tags=["proactive"])


class Intervention(BaseModel):
    type: str
    params: dict


class ProactiveResponse(BaseModel):
    intervention: Intervention | None = None


@router.get("/proactive", response_model=ProactiveResponse)
async def proactive(user_id: str, route_id: str, request: Request):
    db = request.app.state.db
    redis = getattr(request.app.state, "redis", None)
    try:
        result = await get_intervention(db, redis, user_id, route_id)
    except RouteNotFoundError:
        logger.warning("프로액티브 요청 — 존재하지 않거나 소유하지 않은 route_id: %s", route_id)
        raise HTTPException(status_code=404, detail="여행 일정을 찾을 수 없습니다.")
    return ProactiveResponse(intervention=result)
```

**주의사항:**
- **조회이므로 GET**. 기존 엔드포인트가 전부 POST인 것은 생성·스트리밍이라서다
- `language` 파라미터를 받지 않는다 — 서버는 문구를 만들지 않는다
- `main.py`에 `app.include_router(proactive.router)` 등록 필수

---

### Step 5 — Spring: DTO + Controller + Client ✏️🆕

**왜 필요한가:** 앱은 FastAPI를 직접 못 부른다(`X-Internal-Key`는 서버 간 비밀). 소유권 검증도 Spring 책임이다.

```java
// ProactiveController.java 🆕
@RestController
@RequestMapping("/v1/routes/{routeId}")   // BudgetController와 동일한 prefix 규칙
@RequiredArgsConstructor
public class ProactiveController {

    private final RouteRepository routeRepository;
    private final AiServiceClient aiServiceClient;

    @GetMapping("/proactive")
    public ApiResponse<ProactiveResponse> proactive(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        return ApiResponse.ok(aiServiceClient.proactive(userId.toString(), routeId.toString()));
    }
}
```

```java
// AiServiceClient.proactive() ✏️ — chat()과 같은 패턴이되 실패 처리가 다르다
public ProactiveResponse proactive(String userId, String routeId) {
    try {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(fastapiUrl + "/ai/proactive?user_id=" + userId + "&route_id=" + routeId))
                .header("X-Internal-Key", internalApiKey)
                .GET()
                .timeout(Duration.ofSeconds(5))     // 배너는 빨리 실패하는 게 낫다
                .build();
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 404) {
            throw new BusinessException(ErrorCode.ROUTE_NOT_FOUND);
        }
        if (response.statusCode() >= 400) {
            log.warn("프로액티브 조회 실패 — 개입 없음으로 처리: status={}", response.statusCode());
            return ProactiveResponse.empty();       // ← 예외로 승격하지 않는다
        }
        return objectMapper.readValue(response.body(), ProactiveResponse.class);
    } catch (BusinessException e) {
        throw e;
    } catch (Exception e) {
        log.warn("프로액티브 요청 실패 — 개입 없음으로 처리: {}", e.getMessage());
        return ProactiveResponse.empty();           // ← 타임아웃도 마찬가지
    }
}
```

**주의사항:**
- **`chat()`과 실패 처리가 다르다.** 챗봇은 실패하면 유저가 답을 못 받으니 에러를 던져야 하지만, 배너는 안 떠도 그만이라 **빈 응답으로 삼킨다.** 이게 FFE 대원칙의 구현부다
- 타임아웃 5초 — `chat()`의 15초보다 짧게. 배너를 오래 기다릴 이유가 없다
- `RateLimitFilter.RULES`에 추가:
  ```java
  new Rule(new AntPathRequestMatcher("/v1/routes/*/proactive", "GET"),
           "ratelimit:proactive:", 30, Duration.ofSeconds(60))
  ```

---

### Step 6 — 프론트: 배너 + 맥락 전달 ✏️🆕

**왜 필요한가:** 판단 결과를 유저가 볼 수 있게 하고, 탭하면 대화로 이어준다.

**6-1. `lib/api/proactive.ts` 🆕** — `lib/api/chat.ts` 패턴 그대로.

**6-2. `components/route/ProactiveBanner.tsx` 🆕**

```tsx
export function ProactiveBanner({ routeId }: { routeId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['proactive', routeId],
    queryFn: () => getProactive(routeId),
    staleTime: 1000 * 60 * 5,
    retry: false,          // 배너는 재시도할 가치가 없다
  });

  const intervention = data?.intervention;
  if (!intervention || isDismissedToday(routeId, intervention.type)) return null;

  // 문구는 전적으로 i18n — 서버 응답에 표시용 문자열이 없다
  const text = t(`proactive.${intervention.type}`, intervention.params);
  ...
}
```

**6-3. `lib/i18n/locales/{ko,en,ja,zh}.json` ✏️** — `proactive.*` 키. `params`를 i18next 보간으로 받는다.

```json
"proactive": {
  "DEPARTURE_SOON": "{{minutesLeft}}분 뒤엔 나가셔야 해요 ({{nextPlaceName}}까지 {{transportMinutes}}분)",
  "EMPTY_DAY": "오늘은 일정이 비어 있어요. 근처 뭘 볼까요?",
  ...
}
```

**6-4. `(tabs)/index.tsx` ✏️** — 홈 화면 상단에 배너 삽입. 이미 `getMyRoutes`를 `useQuery`로 가져오고 있어 `routeId`를 바로 쓸 수 있다.

**6-5. `stores/useChatStore.ts` ✏️** — 맥락 전달

```ts
pendingProactive: { type: string; params: Record<string, unknown> } | null;

// 배너 탭 시: 어시스턴트 말풍선 1개를 미리 넣고 맥락을 저장
seedFromProactive: (type, params, text) => set((s) => ({
  messages: [...s.messages, { id: `${Date.now()}-proactive`, role: 'assistant',
                              content: text, createdAt: new Date() }],
  pendingProactive: { type, params },
})),

// sendMessage 첫 호출에만 실어 보내고 즉시 클리어
```

**6-6. 출국 일시 입력칸 ✏️** — `route/[routeId]/index.tsx`. 선택 입력이며 미입력이 기본이다.

**주의사항:**
- **에러 시 아무것도 그리지 않는다.** `Alert`·토스트 금지 (FFE #11)
- `retry: false` — 실패한 배너를 재시도하면 앱 시작이 느려진다
- NativeWind + `TouchableOpacity` 조합은 `className` 대신 `style` 사용 (프로젝트 기존 이슈)
- dismissal은 MMKV. 키 `proactive:{routeId}:{type}:{YYYY-MM-DD}`

---

### Step 7 — 계측 ✏️

**왜 필요한가:** 설계 문서 §계측 — 안 재면 베타를 돌려도 배운 게 없다.

**어떻게:** Amplitude가 미연동이므로 **서버 로그로만** 남긴다. 신규 인프라를 만들지 않는다.

- `proactive_shown` — FastAPI가 개입을 반환할 때 `logger.info`. 프론트 작업 불필요
- `proactive_tapped` / `proactive_dismissed` — `POST /v1/routes/{routeId}/proactive/feedback` 신설, 바디 `{ type, action }`. **DB 저장 없이 로그만.** 베타 50명 규모에서 `grep`으로 충분하다

```
[proactive] shown type=WEATHER_ALERT route=... user=...
[proactive] tapped type=WEATHER_ALERT route=... user=...
```

---

## 검증 방법

```bash
# 1. 규칙 단위 테스트 — 순수 함수라 DB 없이 dict만 넣으면 된다
cd ai && .venv/bin/python -m pytest tests/test_proactive_rules.py -q
# 기대: 규칙 8종 × (발동 / 미발동) 케이스 통과, 기존 81개 회귀 없음

# 2. 마이그레이션 적용
cd backend && ./gradlew flywayMigrate
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c "\d routes" | grep departure_at
# 기대: departure_at | timestamp with time zone |

# 3. FastAPI 단독 — 여행 기간 밖
curl -H "X-Internal-Key: $KEY" \
  "http://localhost:8000/ai/proactive?user_id=<uid>&route_id=<과거루트>"
# 기대: {"intervention":null}

# 4. FastAPI 단독 — 여행 중, 오늘 일정 비움
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c \
  "DELETE FROM route_slots WHERE route_id='<rid>' AND day_number=<오늘>;"
curl -H "X-Internal-Key: $KEY" "http://localhost:8000/ai/proactive?user_id=<uid>&route_id=<rid>"
# 기대: {"intervention":{"type":"EMPTY_DAY","params":{...}}}

# 5. 날씨 캐시 확인 — 두 번째 호출은 API를 안 탄다
docker exec cloumy-redis-1 redis-cli KEYS "weather:forecast:*"
# 기대: weather:forecast:37.57:126.98

# 6. Redis 죽여도 동작하는지 (FFE #3)
docker stop cloumy-redis-1
curl -H "X-Internal-Key: $KEY" "http://localhost:8000/ai/proactive?..."
# 기대: 200 정상 응답 (캐시만 미스). 500 나오면 fail-open 실패
docker start cloumy-redis-1

# 7. FastAPI 죽여도 앱이 멀쩡한지 (FFE #10) — 가장 중요
# FastAPI 중지 후
curl -H "Authorization: Bearer $JWT" "http://localhost:8080/v1/routes/<rid>/proactive"
# 기대: {"success":true,"data":{"intervention":null}}  ← 500이면 안 됨

# 8. 레이트리밋
for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code} " \
  -H "Authorization: Bearer $JWT" "http://localhost:8080/v1/routes/<rid>/proactive"; done
# 기대: 30개 200 후 429

# 9. 회귀
cd ai && .venv/bin/python -m pytest -q          # 기대: 기존 81 + 신규 통과
cd backend && ./gradlew compileJava -q          # 기대: 에러 없음
cd frontend && ./node_modules/.bin/tsc --noEmit # 기대: 신규 파일발 에러 0

# 10. 앱 실제 확인
npx expo run:ios
# 기대: 홈 화면 상단 배너 노출 → 탭 → 챗봇에 어시스턴트 말풍선 → 답장 시 맥락 이어짐
#       닫으면 그날 다시 안 뜸
```

---

## 체크리스트

**DB·AI**
- [ ] `V19__add_routes_departure_at.sql` — nullable 확인
- [ ] `weather_service.py` — 원본 캐시 + 온도 추출, **기존 반환 형식 불변**
- [ ] `proactive_service.py` — 규칙 8종, 전부 순수 함수
- [ ] `_trip_phase()` 조기 종료 (FFE #1)
- [ ] `_select()` 에 "LLM 교체 지점" 주석
- [ ] `_load_route()` 에 `departure_at` 추가 (챗봇 회귀 없음 확인)
- [ ] `routes/proactive.py` + `main.py` 라우터 등록

**Spring**
- [ ] `ProactiveController` — 소유권 검증
- [ ] `AiServiceClient.proactive()` — **실패 시 빈 응답** (예외 승격 금지)
- [ ] `RateLimitFilter` 규칙 추가 (기존 2개 한도 보존 확인)
- [ ] 피드백 엔드포인트 (로그만)

**Frontend**
- [ ] `lib/api/proactive.ts`
- [ ] `ProactiveBanner.tsx` — 에러 시 무렌더, `retry: false`
- [ ] i18n 4개 언어 × 규칙별 문구
- [ ] 홈 화면 배너 삽입
- [ ] `useChatStore` 맥락 전달 + 첫 메시지 후 클리어
- [ ] 출국 일시 입력칸 (선택)
- [ ] MMKV dismissal

**FFE 확인**
- [ ] Redis 중지 상태에서 200 (#3)
- [ ] FastAPI 중지 상태에서 Spring이 `intervention: null` (#10)
- [ ] 날씨 키 미설정 시 나머지 규칙 동작 (#2)
- [ ] 여행 기간 밖이면 쿼리 1개로 종료 (#1)

**문서·계획**
- [ ] 설계 문서 정정 (숙소 거리 → 직선거리 8km)
- [ ] `docs/04-api-spec.md` 동기화
- [ ] `docs/06-ai-chatbot.md` 갱신
- [ ] `planning/milestones.md:301` 예산 알림 항목 닫기
- [ ] `planning/unimplemented.md` — `business_hours`·`trend_score` 빈 컬럼 기록

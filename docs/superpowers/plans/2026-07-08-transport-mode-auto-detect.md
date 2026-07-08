# 이동수단 자동 판단(거리 기반) 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 루트 생성 시 사용자에게 이동수단(대중교통/자동차/도보)을 묻던 질문을 없애고, 슬롯 간 직선거리(1km 기준)로 walk/transit을 자동 판단하도록 전환한다.

**Architecture:** `ai/app/services/transport_service.py`의 `enrich_transport()`가 `transport_mode` 파라미터를 받지 않고, 각 구간(leg)마다 haversine 거리를 계산해 1km 이하면 walk, 초과면 transit(Tmap API, 실패 시 근사치 폴백)으로 자동 결정한다. 이 함수는 초기 루트 생성과 슬롯 교체(Pin&Reshuffle) 재계산 양쪽에서 재사용되므로, 시그니처 변경 하나로 두 경로 모두 일관되게 반영된다.

**Tech Stack:** FastAPI(Python)/pytest, Spring Boot(Java), React Native/Expo(TypeScript)

**참고 스펙:** `docs/superpowers/specs/2026-07-08-transport-mode-auto-detect-design.md`
**이슈:** #100 · **브랜치:** `feat/100-transport-mode-auto-detect`

## Global Constraints

- 거리 임계값: **1km** (haversine 직선거리, `≤1000m`=walk, `>1000m`=transit)
- DB 스키마 변경 없음 — `routes.transport_mode` 컬럼, `route_slots.transport_to_next` CHECK 제약(`'taxi'` 포함)은 그대로 둔다. 애플리케이션 코드에서만 사용을 중단한다.
- 기존에 이미 생성된 루트의 저장된 `transport_to_next` 값은 백필/재계산하지 않는다. 신규 계산분부터만 적용.
- `frontend/components/route/SlotCard.tsx`의 `TRANSPORT_THEME.taxi`는 과거 데이터 표시 호환을 위해 그대로 둔다(삭제 금지).
- `lib/i18n/locales/*.json`의 `slotCard.transportModes` 키는 이번 변경과 무관 — 절대 건드리지 않는다(`routeCreateStep1.transportModes`만 삭제 대상).

---

### Task 1: FastAPI — `enrich_transport()` 거리 기반 자동 판단으로 전환

**Files:**
- Modify: `ai/app/services/transport_service.py`
- Test: `ai/tests/test_transport_service.py`

**Interfaces:**
- Consumes: `app.services.tsp_service._haversine_m(lat1, lng1, lat2, lng2) -> int`(이미 존재, 변경 없음)
- Produces: `enrich_transport(ordered_slots: list[dict], coord_lookup: dict[str, tuple[float, float]], tmap_api_key: str) -> list[dict]` — **시그니처에서 `transport_mode` 파라미터가 제거됨**(3번째 인자가 이제 `tmap_api_key`). Task 2에서 이 새 시그니처로 호출부를 갱신함.

- [ ] **Step 1: 기존 테스트를 새 시그니처/새 동작 기준으로 갱신 (아직 구현 전 — 실패해야 정상)**

`ai/tests/test_transport_service.py` 전체를 아래 내용으로 교체:

```python
import math

import pytest
from unittest.mock import AsyncMock, patch

from app.services.transport_service import (
    _build_transit_detail,
    _build_transit_summary,
    _estimate_minutes,
    enrich_transport,
)

# 강남역 -> 서울역 직선거리 약 8.4km (1km 초과 → transit 자동 판정)
_GANGNAM = (37.4979, 127.0276)
_SEOUL_STATION = (37.5547, 126.9707)

_R_METERS = 6_371_000


def _point_north_of(origin: tuple[float, float], meters: float) -> tuple[float, float]:
    """origin에서 정북 방향으로 meters만큼 떨어진 좌표. _haversine_m과 동일한 구면 모델이라
    순수 위도 이동에서는 haversine 결과가 R * 라디안값과 정확히 일치해 경계값 테스트에 안전하다."""
    lat, lng = origin
    delta_deg = math.degrees(meters / _R_METERS)
    return (lat + delta_deg, lng)


_ORIGIN = (37.5000, 127.0000)


def test_estimate_minutes_walk_reasonable():
    minutes = _estimate_minutes(8.4, "walk")
    assert 150 < minutes < 170  # 8.4km * 1.3 / 4km/h * 60 ≈ 164분


def test_estimate_minutes_car_reasonable():
    minutes = _estimate_minutes(8.4, "car")
    assert 20 < minutes < 30  # 8.4km * 1.3 / 25km/h * 60 ≈ 26분


def test_estimate_minutes_never_zero():
    assert _estimate_minutes(0.01, "car") >= 1


async def test_enrich_transport_close_distance_is_walk_no_network():
    """1km 이내는 Tmap 호출 없이 거리 근사치로 walk 판정."""
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 300)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "walk"
    assert result[0]["transport_minutes"] > 0
    assert "transport_to_next" not in result[1]  # 마지막 슬롯은 다음 구간이 없음


async def test_enrich_transport_boundary_under_1km_is_walk():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 999)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "walk"


async def test_enrich_transport_boundary_over_1km_is_transit():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    b = _point_north_of(_ORIGIN, 1001)
    coord_lookup = {"a": _ORIGIN, "b": b}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "transit"


async def test_enrich_transport_transit_without_key_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    result = await enrich_transport(slots, coord_lookup, "")
    assert result[0]["transport_to_next"] == "transit"
    assert result[0]["transport_minutes"] > 0  # 근사치로 채워짐
    assert result[0]["transit_summary"] is None  # 키 없으면 노선 요약도 없음
    assert result[0]["transit_detail"] is None


async def test_enrich_transport_transit_api_error_falls_back_to_approximation():
    slots = [{"place_id": "a"}, {"place_id": "b"}]
    coord_lookup = {"a": _GANGNAM, "b": _SEOUL_STATION}
    with patch(
        "app.services.transport_service._tmap_transit_route",
        new=AsyncMock(side_effect=Exception("Tmap API 장애")),
    ):
        result = await enrich_transport(slots, coord_lookup, "dummy-key")
    assert result[0]["transport_minutes"] > 0  # 예외 발생해도 근사치로 폴백, 크래시 없음
    assert result[0]["transit_summary"] is None
    assert result[0]["transit_detail"] is None


async def test_enrich_transport_missing_coord_skips_pair():
    slots = [{"place_id": "a"}, {"place_id": "unknown"}]
    coord_lookup = {"a": _GANGNAM}
    result = await enrich_transport(slots, coord_lookup, "")
    assert "transport_to_next" not in result[0]  # 좌표 없는 상대와는 계산 스킵


def test_build_transit_summary_bus_to_subway_one_transfer():
    itinerary = {"legs": [
        {"mode": "BUS", "route": "143"},
        {"mode": "SUBWAY", "route": "2호선"},
    ]}
    assert _build_transit_summary(itinerary) == "버스 143 → 지하철 2호선 (환승 1회)"


def test_build_transit_summary_all_walk_returns_none():
    itinerary = {"legs": [{"mode": "WALK"}]}
    assert _build_transit_summary(itinerary) is None


def test_build_transit_summary_missing_route_field_no_keyerror():
    itinerary = {"legs": [{"mode": "BUS"}]}  # route 키 자체가 없음
    assert _build_transit_summary(itinerary) == "버스"


def test_build_transit_summary_unknown_mode_skipped():
    itinerary = {"legs": [
        {"mode": "FERRY", "route": "여객선"},
        {"mode": "BUS", "route": "143"},
    ]}
    assert _build_transit_summary(itinerary) == "버스 143"


def test_build_transit_detail_bus_to_subway_one_transfer():
    itinerary = {"legs": [
        {"mode": "WALK", "sectionTime": 143},
        {"mode": "BUS", "route": "143", "sectionTime": 629,
         "start": {"name": "강남역9번출구"}, "end": {"name": "교대역"}},
        {"mode": "SUBWAY", "route": "2호선", "sectionTime": 900,
         "start": {"name": "교대역"}, "end": {"name": "서울역"}},
    ]}
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "143", "board_stop": "강남역9번출구", "alight_stop": "교대역", "minutes": 10},
        {"mode": "지하철", "route": "2호선", "board_stop": "교대역", "alight_stop": "서울역", "minutes": 15},
    ]


def test_build_transit_detail_all_walk_returns_none():
    itinerary = {"legs": [{"mode": "WALK", "sectionTime": 300}]}
    assert _build_transit_detail(itinerary) is None


def test_build_transit_detail_missing_optional_fields_no_keyerror():
    itinerary = {"legs": [{"mode": "BUS"}]}  # route/start/end/sectionTime 전부 없음
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "", "board_stop": "", "alight_stop": "", "minutes": 0}
    ]


def test_build_transit_detail_unknown_mode_skipped():
    itinerary = {"legs": [
        {"mode": "FERRY", "route": "여객선", "start": {"name": "A"}, "end": {"name": "B"}, "sectionTime": 600},
        {"mode": "BUS", "route": "143", "start": {"name": "C"}, "end": {"name": "D"}, "sectionTime": 300},
    ]}
    assert _build_transit_detail(itinerary) == [
        {"mode": "버스", "route": "143", "board_stop": "C", "alight_stop": "D", "minutes": 5}
    ]
```

**주의:** `_point_north_of`/`_ORIGIN`이 새로 추가됐고, 모든 `enrich_transport(...)` 호출에서 3번째 인자(옛 `transport_mode`)가 삭제되고 `tmap_api_key`가 그 자리로 당겨졌다. `test_enrich_transport_no_mode_returns_unchanged`와 `test_enrich_transport_car_maps_to_taxi_label`은 새 설계에 없는 시나리오라 완전히 제거됐다.

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd ai && .venv/bin/pytest tests/test_transport_service.py -v
```
Expected: `enrich_transport() missing 1 required positional argument` 또는 `TypeError: enrich_transport() takes 3 positional arguments but 4 were given` 형태로 다수 실패 (아직 구현 전이므로 옛 4-인자 시그니처와 안 맞음).

- [ ] **Step 3: `enrich_transport()`를 거리 기반 자동 판단으로 재작성**

`ai/app/services/transport_service.py`에서 다음 부분을 교체:

```python
# 기존 (삭제)
# routes.transport_mode(walk/car/transit) → route_slots.transport_to_next 허용값 매핑
# DB CHECK 제약이 'car'가 아니라 'taxi'를 요구함(V4 마이그레이션 기존 설계)
_MODE_TO_SLOT_LABEL = {"walk": "walk", "car": "taxi", "transit": "transit"}
```

위 블록을 아래로 교체:

```python
# 슬롯 간 직선거리가 이 값 이하면 walk, 초과면 transit으로 자동 판단한다.
# 500m는 관광지 밀집 구역의 흔한 이동 거리(예: 북촌↔경복궁 약 1km)까지 대중교통으로
# 유도할 위험이 있고, 이런 짧은 거리는 정류장 이동·대기·환승 오버헤드 때문에
# 대중교통이 오히려 도보보다 느린 경우가 많아 1km로 설정.
_WALK_MAX_METERS = 1000
```

그리고 `enrich_transport()` 전체를 아래로 교체:

```python
async def enrich_transport(
    ordered_slots: list[dict],
    coord_lookup: dict[str, tuple[float, float]],
    tmap_api_key: str,
) -> list[dict]:
    """TSP로 이미 정렬된 하루치 슬롯에 slot[i] -> slot[i+1] 구간 이동시간을 채운다.

    각 구간의 직선거리로 walk/transit을 자동 판단한다(_WALK_MAX_METERS 이하=walk).
    대중교통 API가 실패하면(키 미설정 포함) 거리 근사치로 폴백해서
    "정보 없음"보다는 대략적인 값을 보여준다.
    """
    async with httpx.AsyncClient() as client:
        for i in range(len(ordered_slots) - 1):
            id_a = str(ordered_slots[i].get("place_id", ""))
            id_b = str(ordered_slots[i + 1].get("place_id", ""))
            if id_a not in coord_lookup or id_b not in coord_lookup:
                continue
            lat1, lng1 = coord_lookup[id_a]
            lat2, lng2 = coord_lookup[id_b]

            distance_m = _haversine_m(lat1, lng1, lat2, lng2)
            label = "walk" if distance_m <= _WALK_MAX_METERS else "transit"

            minutes, summary, detail = None, None, None
            if label == "transit" and tmap_api_key:
                try:
                    result = await _tmap_transit_route(client, lat1, lng1, lat2, lng2, tmap_api_key)
                    if result is not None:
                        minutes, summary, detail = result
                except Exception as e:
                    logger.warning("Tmap 대중교통 API 오류 — 근사치로 폴백: %s", e)

            if minutes is None:
                distance_km = distance_m / 1000
                minutes = _estimate_minutes(distance_km, label)

            ordered_slots[i]["transport_to_next"] = label
            ordered_slots[i]["transport_minutes"] = minutes
            ordered_slots[i]["transit_summary"] = summary
            ordered_slots[i]["transit_detail"] = detail

    return ordered_slots
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd ai && .venv/bin/pytest tests/test_transport_service.py -v
```
Expected: 전체 PASS (신규 3개 테스트 포함).

- [ ] **Step 5: Commit**

```bash
git add ai/app/services/transport_service.py ai/tests/test_transport_service.py
git commit -m "$(cat <<'EOF'
refactor: ♻️ [AI] enrich_transport 거리 기반 자동 판단으로 전환

transport_mode 파라미터를 없애고 슬롯 간 haversine 거리(1km 기준)로
walk/transit을 자동 판단하도록 변경. 초기 생성과 슬롯 교체 재계산
양쪽이 이 함수를 공유해 시그니처 변경 하나로 일관되게 반영됨.
EOF
)"
```

---

### Task 2: FastAPI — `enrich_transport()` 호출부 갱신

**Files:**
- Modify: `ai/app/services/route_service.py:329`
- Modify: `ai/app/models/schemas.py:23`
- Modify: `ai/app/routes/slot_transport.py:17,34`

**Interfaces:**
- Consumes: Task 1의 `enrich_transport(ordered_slots, coord_lookup, tmap_api_key)`
- Produces: 없음(리프 호출부, Task 3에서 참조 안 함)

- [ ] **Step 1: `route_service.py`의 `_finalize_day()` 호출부 수정**

`ai/app/services/route_service.py:329`:

```python
# 기존
enriched = await enrich_transport(slots, coord_lookup, request.transport_mode, settings.tmap_api_key)
```

```python
# 변경 후
enriched = await enrich_transport(slots, coord_lookup, settings.tmap_api_key)
```

- [ ] **Step 2: `models/schemas.py`에서 `RouteGenRequest.transport_mode` 필드 삭제**

`ai/app/models/schemas.py:23`의 아래 줄을 삭제:

```python
    transport_mode: Literal["transit", "car", "walk"] | None = None
```

- [ ] **Step 3: `routes/slot_transport.py`에서 `SlotTransportRequest.transport_mode` 필드 삭제 + 호출부 수정**

`ai/app/routes/slot_transport.py:17`의 아래 줄을 삭제:

```python
    transport_mode: str | None = None
```

`ai/app/routes/slot_transport.py:34`:

```python
# 기존
enriched = await enrich_transport(ordered, coord_lookup, req.transport_mode, settings.tmap_api_key)
```

```python
# 변경 후
enriched = await enrich_transport(ordered, coord_lookup, settings.tmap_api_key)
```

- [ ] **Step 4: 전체 AI 테스트 스위트 실행 → 회귀 없는지 확인**

```bash
cd ai && .venv/bin/pytest -v
```
Expected: 전체 PASS (Task 1의 `test_transport_service.py` 포함, 다른 테스트 파일 회귀 없음).

- [ ] **Step 5: FastAPI 모듈 임포트 확인 (스키마/라우터 문법 오류 조기 발견)**

```bash
cd ai && .venv/bin/python3 -c "import app.routes.route_gen, app.routes.slot_transport; print('import OK')"
```
Expected: `import OK`

- [ ] **Step 6: Commit**

```bash
git add ai/app/services/route_service.py ai/app/models/schemas.py ai/app/routes/slot_transport.py
git commit -m "$(cat <<'EOF'
refactor: ♻️ [AI] enrich_transport 호출부에서 transport_mode 인자 제거

Task 1의 시그니처 변경에 맞춰 route_service.py/slot_transport.py
호출부와 RouteGenRequest/SlotTransportRequest 스키마 정리.
EOF
)"
```

---

### Task 3: Spring — `transportMode` 배관 전체 제거

**Files:**
- Modify: `backend/src/main/java/com/cloumy/trip/dto/RouteGenRequest.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/AiServiceClient.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/RouteSlotService.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/RouteService.java`
- Modify: `backend/src/main/java/com/cloumy/trip/entity/Route.java`

**Interfaces:**
- Consumes: 없음(백엔드 테스트 코드 없음 — `backend/src/test` 비어있음, `./gradlew compileJava`가 유일한 안전망)
- Produces: 없음(Task 4 프론트는 HTTP JSON 계약으로만 연결되고, `transportMode` 필드가 요청 바디에서 사라지는 것뿐이라 Java 타입 의존 없음)

- [ ] **Step 1: `RouteGenRequest.java`에서 `transportMode` 필드 삭제**

`backend/src/main/java/com/cloumy/trip/dto/RouteGenRequest.java`:

```java
// 기존
import jakarta.validation.constraints.Pattern;
```
이 import 줄을 삭제(파일 내 `@Pattern` 사용처가 이 필드 하나뿐).

```java
// 기존
        @Pattern(regexp = "transit|car|walk", message = "transportMode는 transit/car/walk 중 하나여야 합니다")
        String transportMode,
```
이 두 줄을 삭제. 최종 필드 목록은 `density,` 다음이 바로 `List<@Valid AccommodationCreateRequest> accommodations,`로 이어짐.

- [ ] **Step 2: `AiServiceClient.java`에서 `transportMode` 관련 코드 전부 제거**

`streamRoute()`의 캐시 우회 조건(현재 위치: `hasAccommodations`/`hasTransportMode` 선언부):

```java
// 기존
            boolean hasAccommodations = !req.accommodationsOrEmpty().isEmpty();
            boolean hasTransportMode = req.transportMode() != null;
            if (!hasAccommodations && !hasTransportMode) {
```

```java
// 변경 후
            boolean hasAccommodations = !req.accommodationsOrEmpty().isEmpty();
            if (!hasAccommodations) {
```

`FastApiRequest` record에서 `transport_mode` 필드 삭제:

```java
// 기존
    private record FastApiRequest(
            String city,
            int nights,
            String group_type,
            String budget_level,
            List<String> themes,
            Double hidden_gem_ratio,
            LocalDate start_date,
            String density,
            String transport_mode,
            List<AccommodationAnchorDto> accommodations,
            String language
    ) {}
```

```java
// 변경 후
    private record FastApiRequest(
            String city,
            int nights,
            String group_type,
            String budget_level,
            List<String> themes,
            Double hidden_gem_ratio,
            LocalDate start_date,
            String density,
            List<AccommodationAnchorDto> accommodations,
            String language
    ) {}
```

`FastApiRequest` 생성 호출부:

```java
// 기존
            FastApiRequest fastApiReq = new FastApiRequest(
                    req.destination(),
                    req.nights(),
                    req.groupType().toLowerCase(),
                    req.budgetLevel().toLowerCase(),
                    req.tags() != null ? req.tags() : List.of(),
                    req.hiddenGemRatio(),
                    req.startDate(),
                    req.density() != null ? req.density().toLowerCase() : "normal",
                    req.transportMode() != null ? req.transportMode().toLowerCase() : null,
                    accommodations,
                    req.language()
            );
```

```java
// 변경 후
            FastApiRequest fastApiReq = new FastApiRequest(
                    req.destination(),
                    req.nights(),
                    req.groupType().toLowerCase(),
                    req.budgetLevel().toLowerCase(),
                    req.tags() != null ? req.tags() : List.of(),
                    req.hiddenGemRatio(),
                    req.startDate(),
                    req.density() != null ? req.density().toLowerCase() : "normal",
                    accommodations,
                    req.language()
            );
```

`SlotTransportReq` record와 `getSlotTransport()` 시그니처:

```java
// 기존
    private record SlotTransportReq(String transport_mode, List<TransportSlotDto> slots) {}

    public List<TransportSlotResult> getSlotTransport(String transportMode, List<TransportSlotDto> slots) {
        try {
            String body = objectMapper.writeValueAsString(new SlotTransportReq(transportMode, slots));
```

```java
// 변경 후
    private record SlotTransportReq(List<TransportSlotDto> slots) {}

    public List<TransportSlotResult> getSlotTransport(List<TransportSlotDto> slots) {
        try {
            String body = objectMapper.writeValueAsString(new SlotTransportReq(slots));
```

- [ ] **Step 3: `RouteSlotService.java`에서 `DEFAULT_TRANSPORT_MODE` 및 관련 게이팅 제거**

클래스 상단의 상수 + 주석 삭제:

```java
// 기존 (삭제)
    // 챗봇 삽입 시 라우트에 이동수단이 지정 안 돼 있어도(transport_mode == null) 이동정보를
    // 아예 안 보여주는 대신 자동차 근사치라도 채우기 위한 기본값. enrich_transport()가
    // walk가 아니면 전부 자동차 속도로 근사하는 구조라 AI 쪽 변경 없이 그대로 재사용 가능.
    private static final String DEFAULT_TRANSPORT_MODE = "car";
```

`replaceSlot()`에서 `route`는 `route.getTransportMode()` 한 곳에만 쓰이고 있었다. 그 용도가 사라지므로 `Route route = ...` 조회 자체를 삭제하고 게이팅 조건도 단순화한다(`verifyOwner()`가 이미 `ErrorCode.ROUTE_NOT_FOUND`를 던지므로 검증 유실 없음):

```java
// 기존
        verifyOwner(routeId, userId);
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        RouteSlot target = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        PlaceProjection newPlace = placeRepository.findPlaceDetailById(req.placeId())
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        target.replacePlace(req.placeId(), req.estimatedCost(), req.reason());

        Optional<RouteSlot> prev = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() - 1);
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() + 1);

        if (route.getTransportMode() != null && (prev.isPresent() || next.isPresent())) {
            recalculateNeighborTransport(route.getTransportMode(), req.placeId(), newPlace, target, prev, next);
        }
```

```java
// 변경 후
        verifyOwner(routeId, userId);
        RouteSlot target = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        PlaceProjection newPlace = placeRepository.findPlaceDetailById(req.placeId())
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        target.replacePlace(req.placeId(), req.estimatedCost(), req.reason());

        Optional<RouteSlot> prev = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() - 1);
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() + 1);

        if (prev.isPresent() || next.isPresent()) {
            recalculateNeighborTransport(req.placeId(), newPlace, target, prev, next);
        }
```

`recalculateNeighborTransport()` 시그니처와 내부 호출:

```java
// 기존
    private void recalculateNeighborTransport(
            String transportMode, UUID newPlaceId, PlaceProjection newPlace,
            RouteSlot target, Optional<RouteSlot> prev, Optional<RouteSlot> next
    ) {
```

```java
// 변경 후
    private void recalculateNeighborTransport(
            UUID newPlaceId, PlaceProjection newPlace,
            RouteSlot target, Optional<RouteSlot> prev, Optional<RouteSlot> next
    ) {
```

같은 메서드 안의 호출부:

```java
// 기존
        List<AiServiceClient.TransportSlotResult> results = aiServiceClient.getSlotTransport(transportMode, ordered);
```

```java
// 변경 후
        List<AiServiceClient.TransportSlotResult> results = aiServiceClient.getSlotTransport(ordered);
```

`insertSlotAfter()`의 기본값 대체 로직:

```java
// 기존
        // replaceSlot과 동일한 이웃 이동정보 재계산 재사용: afterSlot(prev)→newSlot(target)→next
        // 라우트에 이동수단이 지정 안 돼 있으면 DEFAULT_TRANSPORT_MODE("car")로 대체 —
        // 챗봇으로 장소를 추가했는데 "어떻게 가는지" 정보가 아예 안 붙는 체감 버그 방지.
        String effectiveTransportMode = route.getTransportMode() != null
                ? route.getTransportMode() : DEFAULT_TRANSPORT_MODE;
        recalculateNeighborTransport(
                effectiveTransportMode, placeId, newPlace, newSlot, Optional.of(afterSlot), next);
```

```java
// 변경 후
        // replaceSlot과 동일한 이웃 이동정보 재계산 재사용: afterSlot(prev)→newSlot(target)→next.
        // 이제 enrich_transport가 거리 기반으로 자동 판단하므로 이동수단 인자 자체가 불필요.
        recalculateNeighborTransport(placeId, newPlace, newSlot, Optional.of(afterSlot), next);
```

`insertSlotAfter()`의 `Route route = routeRepository.findById(routeId).orElseThrow(...)` 조회(메서드 시작 부근, `verifyOwner(routeId, userId)` 바로 다음 줄)는 이 메서드 안에서 `route.getTransportMode()` 하나에만 쓰이고 있었다. 그 용도가 사라졌으므로 이 조회 자체를 완전히 삭제한다:

```java
// 기존
        verifyOwner(routeId, userId);
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        RouteSlot afterSlot = routeSlotRepository.findById(afterSlotId)
```

```java
// 변경 후
        verifyOwner(routeId, userId);
        RouteSlot afterSlot = routeSlotRepository.findById(afterSlotId)
```

`verifyOwner()`가 이미 내부적으로 동일한 `ErrorCode.ROUTE_NOT_FOUND`를 던지므로(346~352행) 검증 유실 없음 — 순수 중복 조회 제거.

- [ ] **Step 4: `RouteService.java`에서 `.transportMode(...)` 빌더 호출 삭제**

`backend/src/main/java/com/cloumy/trip/service/RouteService.java:70`:

```java
// 기존
                .transportMode(req.transportMode() != null ? req.transportMode().toLowerCase() : null)
```
이 줄을 삭제(바로 위/아래 줄인 `.density(...)`, `.build()` 등 다른 빌더 체인은 그대로 유지).

- [ ] **Step 5: `Route.java` 엔티티에서 `transportMode` 필드/게터 삭제**

`backend/src/main/java/com/cloumy/trip/entity/Route.java`:

```java
// 기존 (삭제)
    @Column(name = "transport_mode")
    private String transportMode;
```

생성자 파라미터/대입도 삭제:

```java
// 기존
    private Route(UUID userId, String title, String destination,
                  LocalDate startDate, LocalDate endDate, int nights,
                  String groupType, String budgetLevel, String[] tags, String density,
                  String transportMode) {
        this.userId = userId;
        this.title = title;
        this.destination = destination;
        this.startDate = startDate;
        this.endDate = endDate;
        this.nights = nights;
        this.groupType = groupType;
        this.budgetLevel = budgetLevel;
        this.tags = tags != null ? tags : new String[]{};
        this.density = density;
        this.transportMode = transportMode;
        this.isPublic = false;
        this.saveCount = 0;
    }
```

```java
// 변경 후
    private Route(UUID userId, String title, String destination,
                  LocalDate startDate, LocalDate endDate, int nights,
                  String groupType, String budgetLevel, String[] tags, String density) {
        this.userId = userId;
        this.title = title;
        this.destination = destination;
        this.startDate = startDate;
        this.endDate = endDate;
        this.nights = nights;
        this.groupType = groupType;
        this.budgetLevel = budgetLevel;
        this.tags = tags != null ? tags : new String[]{};
        this.density = density;
        this.isPublic = false;
        this.saveCount = 0;
    }
```

DB 컬럼(`routes.transport_mode`)은 Global Constraints대로 그대로 둔다 — 엔티티 매핑만 제거하므로 Hibernate가 이 컬럼을 그냥 무시한다(마이그레이션 불필요).

- [ ] **Step 6: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava -q
```
Expected: 에러 없이 종료.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/com/cloumy/trip/dto/RouteGenRequest.java \
        backend/src/main/java/com/cloumy/trip/service/AiServiceClient.java \
        backend/src/main/java/com/cloumy/trip/service/RouteSlotService.java \
        backend/src/main/java/com/cloumy/trip/service/RouteService.java \
        backend/src/main/java/com/cloumy/trip/entity/Route.java
git commit -m "$(cat <<'EOF'
refactor: ♻️ [Spring] transportMode 배관 전체 제거

RouteGenRequest/AiServiceClient/RouteSlotService/RouteService/Route
엔티티에서 transportMode 관련 코드 정리. DEFAULT_TRANSPORT_MODE="car"
하드코딩과 슬롯 교체 시 게이팅 불일치 버그가 함께 해소됨(#100).
DB 컬럼은 유지, 엔티티 매핑만 제거.
EOF
)"
```

---

### Task 4: Frontend — 이동수단 질문 UI 및 관련 타입/키 삭제

**Files:**
- Modify: `frontend/types/index.ts`
- Modify: `frontend/app/route/create/step-1.tsx`
- Modify: `frontend/app/route/create/step-4.tsx`
- Modify: `frontend/lib/i18n/locales/ko.json`
- Modify: `frontend/lib/i18n/locales/en.json`
- Modify: `frontend/lib/i18n/locales/ja.json`
- Modify: `frontend/lib/i18n/locales/zh.json`

**Interfaces:**
- Consumes: 없음(HTTP JSON 바디에서 `transportMode` 필드가 그냥 안 실리게 되는 것뿐 — Task 3 Spring `RouteGenRequest`가 이미 이 필드를 안 받으므로 프론트가 안 보내도 무관)
- Produces: 없음(리프 태스크)

- [ ] **Step 1: `types/index.ts`에서 `TransportMode` 타입/필드 삭제**

```typescript
// 기존
export type TransportMode = 'transit' | 'car' | 'walk';

export interface RouteGenRequest {
  destination: string;
  startDate: string;
  endDate: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  tags: string[];
  hiddenGemRatio?: number;
  density?: Density;
  transportMode?: TransportMode;
  accommodations?: AccommodationInput[];
  totalBudget?: number; // 숙박비 제외 현지 활동/식사 예산, 선택 사항
  language?: SupportedLanguage; // 앱 설정 언어 — 하루요약/팁 텍스트 생성 언어(장소명은 원본 유지)
}
```

```typescript
// 변경 후
export interface RouteGenRequest {
  destination: string;
  startDate: string;
  endDate: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  tags: string[];
  hiddenGemRatio?: number;
  density?: Density;
  accommodations?: AccommodationInput[];
  totalBudget?: number; // 숙박비 제외 현지 활동/식사 예산, 선택 사항
  language?: SupportedLanguage; // 앱 설정 언어 — 하루요약/팁 텍스트 생성 언어(장소명은 원본 유지)
}
```

- [ ] **Step 2: `step-1.tsx`에서 이동수단 질문 블록 전체 삭제**

import 줄에서 아이콘 정리:

```typescript
// 기존
import { ChevronLeft, MapPin, Users, Calendar, ChevronRight, Bus, Car, Footprints } from 'lucide-react-native';
```

```typescript
// 변경 후
import { ChevronLeft, MapPin, Users, Calendar, ChevronRight } from 'lucide-react-native';
```

`TRANSPORT_MODE_VALUES` 상수와 그 위 주석 삭제:

```typescript
// 기존 (삭제)
// 여행 전체 기본 이동수단 — 선택 사항(안 골라도 다음 단계 진행 가능).
// 값이 있을 때만 이동시간 계산에 쓰이고, 대중교통은 Tmap 실API를 호출하므로
// 기본 선택값을 두지 않는다(사용자가 명시적으로 고를 때만 호출 발생).
const TRANSPORT_MODE_VALUES = [
  { value: 'transit', Icon: Bus },
  { value: 'car', Icon: Car },
  { value: 'walk', Icon: Footprints },
] as const;
```

`Step1Form`/zod 스키마에서 `transportMode` 제거:

```typescript
// 기존
interface Step1Form {
  destination: string;
  groupType: (typeof GROUP_TYPE_VALUES)[number];
  transportMode?: (typeof TRANSPORT_MODE_VALUES)[number]['value'];
}

function buildStep1Schema(t: (key: string) => string) {
  return z.object({
    destination: z.string().min(1, t('routeCreateStep1.destinationRequired')),
    groupType: z.enum(['solo', 'couple', 'friends', 'family']),
    transportMode: z.enum(['transit', 'car', 'walk']).optional(),
  });
}
```

```typescript
// 변경 후
interface Step1Form {
  destination: string;
  groupType: (typeof GROUP_TYPE_VALUES)[number];
}

function buildStep1Schema(t: (key: string) => string) {
  return z.object({
    destination: z.string().min(1, t('routeCreateStep1.destinationRequired')),
    groupType: z.enum(['solo', 'couple', 'friends', 'family']),
  });
}
```

JSX에서 "이동수단 (선택)" 섹션 전체 삭제(인원 유형 섹션과 하단 여백 사이):

```tsx
{/* 이동수단 (선택) */}
<View className="mb-8">
  <Text className="font-bold text-slate-700 mb-1">{t('routeCreateStep1.transportLabel')}</Text>
  <Text className="text-xs text-slate-400 mb-4">{t('routeCreateStep1.transportHint')}</Text>
  <Controller
    control={control}
    name="transportMode"
    render={({ field: { value, onChange } }) => (
      <View className="flex-row gap-2">
        {TRANSPORT_MODE_VALUES.map(({ value: modeValue, Icon }) => {
          const selected = value === modeValue;
          return (
            <TouchableOpacity
              key={modeValue}
              onPress={() => onChange(selected ? undefined : modeValue)}
              className={`flex-1 py-3 rounded-2xl border-2 items-center gap-1 ${
                selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
              }`}
            >
              <Icon size={18} color={selected ? '#0284c7' : '#94a3b8'} />
              <Text className={`font-semibold text-sm ${selected ? 'text-sky-600' : 'text-slate-500'}`}>
                {t(`routeCreateStep1.transportModes.${modeValue}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    )}
  />
</View>
```

이 블록을 완전히 삭제 — 바로 앞의 "인원 유형" `</View>`와 바로 뒤의 `<View className="h-4" />` 사이가 빈 채로 이어지면 됨.

- [ ] **Step 3: `step-4.tsx`에서 `transportMode` 파라미터/타입 제거**

```typescript
// 기존
import type { GroupType, BudgetLevel, Density, RouteSlot, AccommodationInput, TransportMode } from '@/types';
```

```typescript
// 변경 후
import type { GroupType, BudgetLevel, Density, RouteSlot, AccommodationInput } from '@/types';
```

```typescript
// 기존
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
    tags: string;
    budgetLevel: string;
    hiddenGemRatio: string;
    density: string;
    transportMode?: string;
    totalBudget?: string;
  }>();
```

```typescript
// 변경 후
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
    tags: string;
    budgetLevel: string;
    hiddenGemRatio: string;
    density: string;
    totalBudget?: string;
  }>();
```

`streamRoute` 호출부:

```typescript
// 기존
        density: selectedDensity,
        transportMode: params.transportMode as TransportMode | undefined,
        accommodations,
```

```typescript
// 변경 후
        density: selectedDensity,
        accommodations,
```

- [ ] **Step 4: 4개 로케일 파일에서 `routeCreateStep1.transportLabel`/`transportHint`/`transportModes` 삭제**

`frontend/lib/i18n/locales/ko.json`:
```json
// 기존 (44~47행)
    "groupTypes": { "solo": "혼자", "couple": "커플", "friends": "친구들", "family": "가족" },
    "transportLabel": "주로 어떻게 이동하세요?",
    "transportHint": "선택하면 장소 사이 이동시간을 계산해드려요 (선택 사항)",
    "transportModes": { "transit": "대중교통", "car": "자동차", "walk": "도보" },
    "nextButton": "다음 단계"
```
```json
// 변경 후
    "groupTypes": { "solo": "혼자", "couple": "커플", "friends": "친구들", "family": "가족" },
    "nextButton": "다음 단계"
```

`frontend/lib/i18n/locales/en.json` (동일 라인 구조, `transportLabel`/`transportHint`/`transportModes` 3줄만 삭제):
```json
    "groupTypes": { "solo": "Solo", "couple": "Couple", "friends": "Friends", "family": "Family" },
    "nextButton": "Next"
```

`frontend/lib/i18n/locales/ja.json`:
```json
    "groupTypes": { ... },
    "nextButton": "次へ"
```

`frontend/lib/i18n/locales/zh.json`:
```json
    "groupTypes": { ... },
    "nextButton": "下一步"
```

**⚠️ 주의**: 4개 파일 모두 138행 부근에 `"slotCard": { "transportModes": {...} }`가 별도로 존재한다 — 이건 `TransportChip` 배지 라벨용으로 이번 삭제 대상이 **아니다**. `routeCreateStep1` 객체 안의 것만 삭제할 것.

- [ ] **Step 5: JSON 문법 검증**

```bash
cd frontend && for f in ko en ja zh; do python3 -c "import json; json.load(open('lib/i18n/locales/$f.json'))" && echo "$f OK"; done
```
Expected: `ko OK` / `en OK` / `ja OK` / `zh OK`

- [ ] **Step 6: 잔여 참조 확인**

```bash
cd frontend && grep -rn "TransportMode\b" app types lib components 2>/dev/null
```
Expected: 출력 없음(타입 자체가 완전히 제거됐는지 확인).

- [ ] **Step 7: 타입체크**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "step-1\|step-4\|transportMode\|TransportMode"
```
Expected: 출력 없음(기존에 있던 무관한 에러들은 다른 grep 패턴에 안 걸리므로 무시).

- [ ] **Step 8: Commit**

```bash
git add frontend/types/index.ts frontend/app/route/create/step-1.tsx \
        frontend/app/route/create/step-4.tsx frontend/lib/i18n/locales/*.json
git commit -m "$(cat <<'EOF'
refactor: ♻️ [Frontend] 이동수단 선택 질문 UI 삭제

route/create/step-1.tsx의 이동수단(대중교통/자동차/도보) 질문을
제거 — 이제 백엔드가 거리 기반으로 자동 판단하므로 불필요(#100).
EOF
)"
```

---

### Task 5: 전체 검증 및 마무리

**Files:** 없음(검증 전용)

**Interfaces:** 없음

- [ ] **Step 1: AI 전체 테스트**

```bash
cd ai && .venv/bin/pytest -v
```
Expected: 전체 PASS.

- [ ] **Step 2: 백엔드 컴파일**

```bash
cd backend && ./gradlew compileJava -q
```
Expected: 에러 없이 종료.

- [ ] **Step 3: 프론트 타입체크 (전체, 이번 변경 관련 신규 에러만 확인)**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -iE "step-1|step-4|transportMode|types/index"
```
Expected: 출력 없음.

- [ ] **Step 4: 도커 스택 기동 후 실제 API로 거리 기반 판단 스모크 테스트**

```bash
docker compose up -d postgres redis
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev' &
# 서버 기동 대기 후 (Flyway/Tomcat 로그로 기동 확인)
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8080/actuator/health
```
Expected: `HTTP 200`

- [ ] **Step 5: 수동 검증 (Expo 앱)**

- `route/create/step-1.tsx`에서 "주로 어떻게 이동하세요?" 질문이 더 이상 안 보이는지 확인
- 새 루트를 생성하고, 슬롯 간 이동수단 배지가 거리에 맞게 walk(가까운 구간)/transit(먼 구간)으로 자동 표시되는지 확인 — 질문을 안 받았는데도 정보가 채워지는 게 핵심
- #99에서 만든 walk/transit 내비 버튼(`SlotCard.tsx`)이 이 루트에서도 정상 동작하는지 확인
- (가능하면) 슬롯을 AI 대안으로 교체(Pin & Reshuffle)해서 그 주변 구간도 거리 기반으로 재계산되는지 확인

- [ ] **Step 6: PR 생성**

```bash
git push -u origin feat/100-transport-mode-auto-detect
gh pr create --title "[✨ Feat] 이동수단 자동 판단(거리 기반)으로 전환 (#100)" --body "$(cat <<'EOF'
## 배경
이동수단 선택 질문(step-1.tsx)이 선택 사항이라 건너뛰면 모든 구간에 이동수단 정보가 안 생기고,
슬롯 교체 시엔 DEFAULT_TRANSPORT_MODE="car" 하드코딩으로 다른 기본값이 적용되는 불일치가 있었음.

Closes #100

## 변경 사항
- AI: enrich_transport()가 거리 기반(1km 기준)으로 walk/transit 자동 판단
- Spring: transportMode 배관 전체 제거, DEFAULT_TRANSPORT_MODE="car" 하드코딩 및 게이팅 불일치 해소
- Frontend: 이동수단 선택 질문 UI 삭제

## 설계 문서
docs/superpowers/specs/2026-07-08-transport-mode-auto-detect-design.md

## 검증
- [x] AI 테스트 전체 통과 (1km 경계값 테스트 포함)
- [x] 백엔드 컴파일 통과
- [x] 프론트 타입체크 통과
- [x] 실제 루트 생성으로 거리 기반 자동 판단 확인
EOF
)"
```

- [ ] **Step 7: 사용자 승인 후 머지**

사용자에게 PR 링크를 보여주고 승인받은 뒤 `gh pr merge --merge --delete-branch` 실행.

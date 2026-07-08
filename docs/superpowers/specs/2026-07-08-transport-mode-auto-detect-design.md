# 이동수단 자동 판단(거리 기반) 전환 설계

## 배경

루트 생성 시 `route/create/step-1.tsx`에서 "주로 어떻게 이동하세요?" (대중교통/자동차/도보) 질문을 선택 사항으로 받아, 그 값 하나를 루트 전체 모든 구간(`route_slots.transport_to_next`)에 동일하게 적용하고 있었다(`ai/app/services/transport_service.py:enrich_transport`). 문제:

- 질문을 건너뛰면(선택 사항이라 흔함) `transport_mode`가 없어 해당 루트는 **모든 구간에 이동수단 정보 자체가 안 생김**(아이콘·소요시간 전부 미표시)
- 반면 슬롯을 AI 대안으로 교체(Pin & Reshuffle)할 때는 `RouteSlotService.java`의 `DEFAULT_TRANSPORT_MODE = "car"` 하드코딩 때문에, 이동수단을 안 골랐던 루트라도 그 순간부터 교체된 슬롯 주변만 "car"(택시로 표시) 기본값이 적용됨 — 같은 루트 안에서 두 가지 다른 동작이 섞임
- 기본값이 "car"인 것도 문제: Cloumy 타겟(방한 외국인 관광객)은 한국에서 렌트카를 몰거나 택시만 타고 다닐 가능성이 거의 없어, 실효성 없는 선택지에 안 좋은 기본값까지 얹힌 상태

방금 완료한 "지도 내비 walk/transit 2-way" 기능(#99)도 이 `transport_to_next` 값에 의존하는데, 위 문제 때문에 실제로는 대부분의 루트에서 내비 버튼 자체가 안 뜰 가능성이 높았다.

## 범위

**포함**: 이동수단 질문 UI 삭제, `enrich_transport()`를 거리 기반 자동 판단으로 전환, 이 함수를 공유하는 초기 생성/슬롯 교체 두 경로 모두 반영, 관련 프론트/백엔드/AI 코드 정리.

**제외**: DB 스키마 변경 없음(`routes.transport_mode` 컬럼, `route_slots.transport_to_next` CHECK 제약의 `'taxi'` 값 모두 그대로 유지 — 마이그레이션 불필요, 애플리케이션 코드만 안 씀). 기존에 이미 생성된 루트의 저장된 `transport_to_next` 값 백필/재계산 없음(신규 계산분부터만 적용).

## 핵심 변경

`enrich_transport()`가 `transport_mode` 파라미터를 받지 않고, 슬롯 간 haversine 직선거리로 매 구간마다 자동 판단한다:

```
거리 ≤ 1km → transport_to_next = "walk"  (기존 도보 근사치 로직 재사용)
거리 > 1km → transport_to_next = "transit" (Tmap 대중교통 API 호출,
             실패/경로없음 시 기존처럼 거리기반 근사치로 폴백)
```

1km(도보 약 12분) 기준. 500m는 관광지 밀집 구역의 흔한 이동 거리(예: 북촌↔경복궁 약 1km)까지 대중교통으로 유도할 위험이 있고, 이런 짧은 거리는 정류장 이동·대기·환승 오버헤드 때문에 대중교통이 오히려 도보보다 느린 경우가 많아 1km로 상향.

이 함수는 초기 루트 생성(`/ai/routes/generate`)과 슬롯 교체 재계산(`/ai/routes/slots/transport`) 양쪽에서 그대로 재사용되므로, 시그니처 변경 하나로 두 경로가 자동으로 일관된 동작을 갖는다.

## 파일별 변경 사항

### FastAPI (`ai/`)

- **`app/services/transport_service.py`**: `enrich_transport()` 시그니처에서 `transport_mode` 파라미터 제거. 거리 기반 판단 함수 추가(1km 임계값 상수화). `_MODE_TO_SLOT_LABEL`(car→taxi 매핑) 제거 — car 옵션 자체가 없어져 불필요. Tmap 실패 시 폴백 계산(`_estimate_minutes(distance_km, "car")`)은 그대로 유지(거리가 1km 초과라 도보 속도가 아닌 차량 속도 근사치가 맞음).
- **`app/services/route_service.py`**: `_finalize_day()`의 `enrich_transport(...)` 호출에서 `request.transport_mode` 인자 제거.
- **`app/models/schemas.py`**: `RouteGenRequest.transport_mode` 필드 삭제.
- **`app/routes/slot_transport.py`**: `SlotTransportRequest.transport_mode` 필드 삭제, 호출부 인자 제거.
- **`tests/test_transport_service.py`**: `test_enrich_transport_no_mode_returns_unchanged`, `test_enrich_transport_car_maps_to_taxi_label` 삭제(새 설계에 없는 시나리오). `test_enrich_transport_walk_uses_approximation_no_network`는 1km 이내 좌표 픽스처로 교체. 나머지 transit 관련 테스트는 `transport_mode` 인자만 제거(강남↔서울역 8.4km는 그대로 1km 초과라 자동 transit 판정됨). 1km 경계값(walk/transit 갈림) 테스트 신규 추가.

### Spring (`backend/`)

- **`dto/RouteGenRequest.java`**: `transportMode` 필드 삭제.
- **`service/AiServiceClient.java`**: `FastApiRequest.transport_mode` 필드 삭제. `streamRoute()`의 `hasTransportMode` 캐시 우회 조건 삭제(accommodations 조건만 남음). `getSlotTransport(String transportMode, ...)` → `getSlotTransport(...)`로 인자 제거, `SlotTransportReq`도 동일 정리.
- **`service/RouteSlotService.java`**: `DEFAULT_TRANSPORT_MODE = "car"` 상수 삭제. `route.getTransportMode() != null && (prev.isPresent() || next.isPresent())` 게이팅 조건을 `(prev.isPresent() || next.isPresent())`로 단순화(이웃 슬롯이 있으면 항상 재계산). `effectiveTransportMode` 관련 코드 삭제.
- **`service/RouteService.java`**: `createRoute()`의 `.transportMode(...)` 빌더 호출 삭제.
- **`entity/Route.java`**: `transportMode` 필드/게터 삭제(DB 컬럼은 그대로 두고 엔티티 매핑만 제거).
- 백엔드 테스트 코드 없음(`backend/src/test` 비어있음) — 변경 불필요.

### Frontend

- **`app/route/create/step-1.tsx`**: "이동수단 (선택)" 질문 블록 전체 삭제 — UI, `Controller`, zod 스키마의 `transportMode` 필드, `TRANSPORT_MODE_VALUES` 상수.
- **`types/index.ts`**: `TransportMode` 타입, `RouteGenRequest.transportMode` 필드 삭제.
- **`app/route/create/step-4.tsx`**: `streamRoute` 호출부에서 `transportMode: ...` 삭제, 관련 미사용 import 정리.
- **`lib/i18n/locales/{ko,en,ja,zh}.json`**: `routeCreateStep1.transportLabel`/`transportHint`/`transportModes` 키 삭제. ⚠️ `slotCard.transportModes`는 별개 키(TransportChip 배지 라벨용)라 그대로 둠.
- **`components/route/SlotCard.tsx`**: `TRANSPORT_THEME.taxi`는 그대로 유지 — 이번 변경 이전에 이미 생성된 루트에 `transport_to_next='taxi'`가 저장돼 있을 수 있어 과거 데이터 표시 호환용. 새 루트는 이제 taxi를 절대 생성하지 않지만 코드 정리 대상 아님.

## 에러 처리

거리 계산 자체는 순수 haversine 연산이라 실패하지 않는다. 기존 에러 처리를 그대로 재사용:

- 좌표 없는 슬롯 쌍: 기존처럼 조용히 스킵.
- Tmap API 실패/타임아웃/경로 없음(거리 1km 초과라 transit으로 판단된 구간): 기존 폴백(`_estimate_minutes(distance_km, "car")`) 그대로 재사용.
- 1km 경계값은 `≤`/`>`로 명확히 양분해 동률 케이스 없음.

이번 변경으로 신규 도입되는 실패 시나리오는 없다.

## 검증 방법

```bash
# 1. AI 서비스 단위 테스트
cd ai && .venv/bin/pytest tests/test_transport_service.py -v
# → 1km 경계값 테스트 포함 전체 통과

# 2. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 3. 프론트 타입체크
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "step-1\|step-4\|transportMode"
# → 신규 에러 없음

# 4. 수동 검증 (Expo 앱)
# - 루트 생성 시 이동수단 질문이 안 뜨는지
# - 생성된 루트의 슬롯 배지가 거리에 맞게 walk/transit 자동 표시되는지
# - #99에서 만든 walk/transit 내비 버튼이 이제 모든 루트에서 동작하는지
```

# 사전 고정(pinned) 슬롯 기반 설계

## 배경

"콘서트·이벤트 앵커"와 "공유 루트에서 장소 가져오기" 두 기능을 동시에 요청받았는데, 둘 다 본질은 같다 — **AI가 루트를 생성하기 전에 이미 정해진 장소를, 그 주변으로 나머지 일정을 채우는 방식**으로 다뤄야 한다. 콘서트는 "시각까지 고정된 확정 일정", 가져온 장소는 "시각은 없지만 반드시 포함돼야 하는 확정 일정"이라는 차이만 있다.

이 둘을 각각 따로 설계하면 "루트 생성 파이프라인에 확정 슬롯을 주입하는 로직"이 중복 구현될 위험이 커서, 공통 기반부터 먼저 설계한다. 이 스펙은 **공통 기반만** 다루고, 실제 유저가 이 기반을 사용하는 두 기능(공유 루트 가져오기, 콘서트 앵커)은 각각 별도 스펙으로 이어서 진행한다.

기존 시스템에 이미 "핀(⭐, `is_pinned`)" 개념이 있다 — 생성 후 유저가 특정 슬롯을 리셔플·삭제로부터 보호하는 기능(`RouteSlot.togglePin()`, `SlotCard.tsx`의 별 아이콘). "이미 정해진 장소라 AI가 건드리면 안 됨"이라는 의미가 정확히 같으므로, 새 개념을 만들지 않고 **생성 시작 전에 미리 `is_pinned=true` 슬롯을 만들어두는 것**으로 확장한다.

## 범위

**포함**:
- 생성 요청에 "이미 확정된 장소 목록"(day 번호 + place)을 실어 보내는 계약 신설
- 백엔드가 AI 스트리밍 시작 전에 이 장소들을 `is_pinned=true` `route_slots`로 먼저 저장
- FastAPI 쪽 day별 슬롯 생성 로직이 "이미 확정된 장소"를 인지해서 (a) Claude에게 중복 추천하지 않도록 후보에서 제외 + 그만큼 생성 개수 차감, (b) 그 날의 동선 재정렬(TSP) 계산에 확정 장소 좌표를 포함

**제외** (각 후속 스펙에서 다룸):
- 콘서트처럼 "고정 시각"까지 강제하는 제약(time-windowed 라우팅) — 이번엔 day 단위 포함만 보장하고, 그 안에서 정확히 몇 시에 배치할지는 기존 `_assign_start_times`(누적 계산)에 맡긴다
- "공유 루트 브라우징 + 체크박스 선택" UI 전체 — 다음 스펙(공유 루트 가져오기)
- 콘서트 검색(Serper/KOPIS) + `events` 테이블 — 그 다음 스펙(콘서트 앵커). 이벤트는 `places` 테이블에 없는 대상이라 이 스펙의 "기존 place 참조" 전제가 그대로 안 맞아서, 콘서트 스펙에서 별도로 다룬다
- 숙소 앵커(`accommodation_anchors`, TSP 출발=도착 depot) 로직 변경 — 이번 기반과는 별개 메커니즘으로 그대로 둠

## 핵심 변경

**데이터 흐름**:

```
1. (프론트, 후속 스펙에서 구현) 유저가 route/create 위저드에서 확정 장소 선택
   → fixedSlots: [{ placeId, dayNumber }] 형태로 모아둠

2. POST /v1/routes/generate 요청에 fixedSlots 포함

3. RouteController.generate()
   → routeService.createRoute(req, userId)로 Route 생성 (기존과 동일)
   → routeSlotService.createFixedSlots(route.id, req.fixedSlots())  ← 신규
      day_number, place_id로 route_slots를 is_pinned=true로 즉시 저장
      (order_index는 임시로 day별 매우 큰 값 — AI가 그 날의 나머지 슬롯을
       스트리밍 저장한 뒤, day 완료 시점 TSP 재정렬에서 최종 order_index로 확정됨)
   → AI 스트리밍 시작 (기존과 동일), 이때 fixedSlots도 함께 FastAPI에 전달

4. FastAPI stream_route()
   → day별 클러스터링/프롬프트 생성 시, 그 day에 이미 고정된 place_id를
     candidate_lookup에서 제외 + slot_cap에서 고정 개수만큼 차감
   → _finalize_day()의 reorder_slots() 호출 시, AI가 만든 좌표 리스트에
     고정 슬롯 좌표를 합류시켜 TSP가 함께 최적 경로를 계산
   → 고정 슬롯 자체는 개별 스트리밍 라인으로 다시 내보내지 않음(이미 DB에 있음).
     대신 day 완료 시점에 그 day의 "최종 순서"(고정 + AI 슬롯 전체를 아우르는
     place_id 배열)를 day_summary와 같은 자리에 별도 라인(type: "day_order")으로
     한 번 내보낸다 — Spring이 이걸로 order_index를 최종 확정하는 데 씀

5. Spring 쪽:
   - saveStreamingLine()이 개별 슬롯을 저장할 때는 order_index를 고정 슬롯과
     충돌하지 않는 임시 값(day별로 매우 큰 오프셋)으로 잠정 배정
   - "day_order" 라인을 받으면, 그 day의 전체 슬롯(고정 + 방금 스트리밍된 것)을
     이 배열 순서대로 최종 order_index로 확정 — "상세보기 슬롯 재정렬"에서 만든
     `RouteSlotService.reorderSlots()`의 2단계 안전 갱신(유니크 제약 회피용 임시
     오프셋 → 최종 인덱스, 슬롯별 개별 flush)을 그대로 재사용
   - 이후 recomputeStartTimesForDay()로 시작 시각 재계산(기존 로직 재사용)
```

**왜 TSP 쪽 변경이 없는가**: `tsp_service.py`의 `_tsp_order(coords, anchor=...)`는 이미 "그 날 방문해야 할 좌표 전체"를 받아 순회 경로를 최적화하는 구조다. 고정 슬롯은 "반드시 방문해야 할 좌표 하나"일 뿐이므로, `reorder_slots()` 호출 시점에 AI가 만든 좌표 리스트에 그냥 합류시키면 TSP가 자연스럽게 포함시킨다. 숙소 앵커처럼 "출발=도착점 고정"이라는 특수 취급이 필요 없다 — 그건 완전히 다른 제약(depot)이라 그대로 유지.

## 파일별 변경 사항

### Spring (`backend/`)

- **`dto/RouteGenRequest.java`**: `fixedSlots: List<FixedSlotRequest>` 필드 추가(nullable, 기존 `accommodations`와 동일 패턴). `fixedSlotsOrEmpty()` 헬퍼 메서드 추가.
- **`dto/FixedSlotRequest.java`** (신규): `record FixedSlotRequest(@NotNull UUID placeId, @NotNull @Min(1) Integer dayNumber)`.
- **`entity/RouteSlot.java`**: 고정 슬롯 생성 경로만 별도로 `pinned=true`를 세팅할 수 있는 정적 팩토리 `RouteSlot.createFixed(...)` 추가(기존 `builder()`는 스트리밍 저장용으로 그대로 둠, 신규 팩토리로 관심사 분리. 기존 생성자는 항상 `pinned=false`로 시작해 이 팩토리가 없으면 고정 슬롯을 만들 수 없음).
- **`service/RouteSlotService.java`**:
  - `createFixedSlots(UUID routeId, List<FixedSlotRequest> fixedSlots)` 신규 — `placeId` 존재 검증(`PlaceRepository`) 후 `RouteSlot.createFixed(...)` 형태로 저장(임시 order_index는 day별로 겹치지 않는 큰 오프셋). `dayNumber`가 여행 박수(`req.nights()+1`) 범위를 벗어나면 `BusinessException(ErrorCode.INVALID_SLOT_ORDER)`(기존 코드 재사용 — 상세보기 재정렬 때 추가한 것과 같은 검증 성격).
  - `applyFinalDayOrder(UUID routeId, int dayNumber, List<UUID> placeIdsInOrder)` 신규 — "상세보기 슬롯 재정렬"에서 만든 `reorderSlots()`의 2단계 안전 갱신(임시 오프셋 → 최종 인덱스, 슬롯별 개별 flush) 로직을 `place_id` 기준으로 조회해 재사용할 수 있도록, 그 두 메서드가 공통으로 쓰는 `private void applyOrderSafely(List<RouteSlot> targets, List<?> orderedKeys, Function<RouteSlot,?> keyFn)` 형태로 추출 — 기존 `reorderSlots()`(slotId 기준)와 이번 케이스(placeId 기준, 같은 day에 같은 place가 중복될 일은 없음이 보장돼 있어 안전)가 같은 헬퍼를 씀. 이후 `recomputeStartTimesForDay()` 호출까지 동일.
- **`controller/RouteController.java`**: `generate()`에서 `routeSlotService.createFixedSlots(route.getId(), req.fixedSlotsOrEmpty())`를 `createRoute()` 직후·스트리밍 시작 전에 호출. 스트리밍 라인 처리 분기(`saveStreamingLine()` 호출부)에 `type: "day_order"` 라인이 오면 `routeSlotService.applyFinalDayOrder(routeId, dayNumber, placeIdsInOrder)`를 호출하는 분기 추가.
- **`service/AiServiceClient.java`**: `FastApiRequest`에 고정 슬롯 정보 추가 — 숙소 앵커(`AccommodationAnchorDto`)와 동일하게 day_number + place의 lat/lng을 FastAPI가 바로 쓸 수 있는 형태로 변환해서 전달(place 좌표 조회는 `PlaceRepository` 재사용).

### FastAPI (`ai/`)

- **`app/models/schemas.py`**: `RouteGenRequest`에 `fixed_slots: list[FixedSlot] = []` 필드 추가. `FixedSlot(place_id, day_number, lat, lng)` 신규 모델(장소명 등은 이미 place_id로 DB에 있으니 좌표만 필요).
- **`app/services/route_service.py`**:
  - `_build_fixed_slots_by_day(fixed_slots)` 신규 헬퍼 — day_number → 그 날 고정된 place_id 집합 + 좌표 리스트로 매핑(`_build_accommodation_anchors`와 같은 형태의 순수 함수).
  - day별 프롬프트 생성 구간(`day_candidate_lookup` 빌드하는 부분, L250 근처): 그 day에 이미 고정된 place_id를 후보에서 제외.
  - `slot_cap` 계산 구간(L322 근처): 그 day의 고정 슬롯 개수만큼 차감(`slot_cap - len(fixed_for_day)`, 최소 0).
  - `_finalize_day()`(L324): `reorder_slots()` 호출 전에 그 day의 고정 슬롯 좌표를 AI가 만든 좌표 리스트에 합류. 재정렬된 최종 순서를 `{"type": "day_order", "day": N, "place_ids": [...]}` 라인으로 day_summary와 같은 자리에서 한 번 내보내도록 반환값에 추가(고정 슬롯이 없는 day는 기존과 동일하게 이 라인을 생략 — Spring 쪽 order_index는 이미 스트리밍 순서대로 맞게 저장되므로 불필요한 재정렬 호출 안 함).
- **`tests/test_route_service.py`**: `_build_fixed_slots_by_day` 순수 함수 단위 테스트 추가(day 매핑, 빈 리스트 케이스). day별 슬롯 생성 로직에 고정 슬롯이 있을 때 후보 제외/개수 차감이 되는지는 통합 테스트 성격이라 기존 테스트 인프라 확인 후 스코프 결정.

## 에러 처리

| 상황 | 처리 |
|---|---|
| `fixedSlots`에 존재하지 않는/삭제된 `placeId` | 400 `PLACE_NOT_FOUND` (기존 에러코드 재사용) |
| `dayNumber`가 여행 박수 범위 밖(예: 2박인데 dayNumber=5) | 400 `INVALID_SLOT_ORDER` (기존 에러코드 재사용) |
| 같은 day에 고정 슬롯이 밀도 상한(`slot_cap`)보다 많음 | 에러 아님 — AI가 채우는 슬롯 수만 0으로 줄이고 고정 슬롯만으로 그 day 구성 |
| 같은 `placeId`가 `fixedSlots`에 중복 | 400 — 같은 장소를 같은 루트에 두 번 고정할 이유 없음(유저 실수/버그로 간주) |
| FastAPI가 고정 슬롯 좌표 없이(place 조회 실패 등) 요청받음 | 그 고정 슬롯은 TSP 합류 없이 스킵 + 로그 경고(전체 생성은 계속 진행 — 다른 day/슬롯까지 막을 이유 없음) |

## 검증 방법

```bash
# 1. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 2. FastAPI 단위 테스트
cd ai && .venv/bin/pytest tests/test_route_service.py -v
# → _build_fixed_slots_by_day 관련 신규 테스트 포함 전체 통과

# 3. 수동 통합 검증 (curl로 fixedSlots 포함해서 /v1/routes/generate 호출)
curl -N -X POST http://localhost:8090/v1/routes/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"destination":"서울","startDate":"2026-08-01","endDate":"2026-08-03",
       "groupType":"solo","budgetLevel":"mid","tags":["카페"],
       "fixedSlots":[{"placeId":"<기존 places.id>","dayNumber":1}]}'
# 기대 결과: day1 슬롯 목록에 지정한 place가 is_pinned=true로 포함,
# 나머지 슬롯 개수가 그만큼 줄어듦, 같은 place가 중복 추천 안 됨

# 4. GET /v1/routes/{routeId}/slots로 재조회해 order_index 충돌(유니크 제약 위반) 없는지 확인
```

## 다음 단계

이 기반이 승인되면:
1. **공유 루트 가져오기** — 공개 루트 브라우징 UI, 체크박스로 장소 선택(전체선택 포함), day 직접 지정 → `fixedSlots`로 변환해 생성 요청에 실음
2. **콘서트·이벤트 앵커** — Serper+KOPIS 검색, `events` 테이블(TTL 7일 캐시), 이벤트를 `places`에 upsert하거나 별도 참조 방식 결정 후 `fixedSlots`와 동일 계약으로 연결 + 고정 시각 제약 추가 설계

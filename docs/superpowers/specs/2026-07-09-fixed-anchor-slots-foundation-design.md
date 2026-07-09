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
   → _finalize_day(day_lines, day_number)가 그 day의 고정 슬롯 라인
     (place_id만 있는 최소 dict, "is_fixed": true)을 day_lines에 합류시킨 뒤
     reorder_slots() → enrich_transport() → _assign_start_times()까지
     기존 파이프라인 전체를 "고정 + AI 슬롯이 섞인 하나의 리스트"로 그대로 통과시킴
     → 고정 슬롯 앞뒤의 이동시간(transport_to_next)도 정확히 계산됨
     (별도 "순서만 알려주는 신호"를 만들지 않는 이유: 이동수단 계산은 반드시
     "그 자리에 낀 상태"로 이웃과 함께 계산돼야 하고, 계산 후 결과를 다시
     솎아내는 것보다 처음부터 하나의 파이프라인으로 흘리는 게 더 단순하고 안전함)
   → 최종적으로 그 day의 모든 슬롯(고정 포함)이 각자 "is_fixed" 플래그를 단 채
     최종 순서·이동정보·시작시각이 채워진 상태로 스트리밍 라인으로 내보내짐

5. Spring 쪽 saveStreamingLine()이 라인별로 분기:
   - "is_fixed": true인 라인 → INSERT 아님, applyFixedSlotResult()(신규)로
     기존 pinned 슬롯(route_id+day_number+place_id로 조회)의 order_index/
     start_time/transport_to_next/transport_minutes/transit_summary/
     transit_detail만 갱신(UPDATE) — pinned 여부·id는 그대로 유지
   - 그 외(일반 AI 슬롯) → 기존 saveStreamingSlot() 그대로(INSERT)
   - 두 경로 모두 order_index는 라인에 실려오는 최종 순서를 그대로 씀
     (FastAPI가 이미 TSP로 확정한 순서라 Spring에서 별도 재정렬 불필요 —
      "상세보기 재정렬" 때처럼 사후에 순서를 바꾸는 상황이 아니라 최초 생성
      시점이라 유니크 제약 충돌 걱정 없이 순서대로 INSERT/UPDATE하면 끝)
```

**왜 TSP 쪽 변경이 없는가**: `tsp_service.py`의 `_tsp_order(coords, anchor=...)`는 이미 "그 날 방문해야 할 좌표 전체"를 받아 순회 경로를 최적화하는 구조다. 고정 슬롯은 "반드시 방문해야 할 좌표 하나"일 뿐이므로, `reorder_slots()` 호출 시점에 AI가 만든 좌표 리스트에 그냥 합류시키면 TSP가 자연스럽게 포함시킨다. 숙소 앵커처럼 "출발=도착점 고정"이라는 특수 취급이 필요 없다 — 그건 완전히 다른 제약(depot)이라 그대로 유지.

**왜 "day_order 신호" 방식을 버렸는가** (설계 중 발견한 문제): 처음엔 고정 슬롯을 TSP 계산에만 참여시키고 스트리밍 출력에서는 빼려고 했는데, 그러면 `enrich_transport()`가 고정 슬롯의 존재를 모른 채 그 앞뒤 슬롯끼리 이동시간을 계산해버려 — 실제로는 A→고정슬롯→B인데 A→B로 잘못 계산됨. 고정 슬롯도 이동수단 계산 파이프라인에 실제로 포함시켜야 앞뒤 구간이 다 정확해지므로, "빼고 나중에 순서만 알려주기"가 아니라 "처음부터 같이 흘리고 저장 시점에 INSERT/UPDATE만 분기"하는 쪽으로 바꿨다.

## 파일별 변경 사항

### Spring (`backend/`)

- **`dto/RouteGenRequest.java`**: `fixedSlots: List<FixedSlotRequest>` 필드 추가(nullable, 기존 `accommodations`와 동일 패턴). `fixedSlotsOrEmpty()` 헬퍼 메서드 추가.
- **`dto/FixedSlotRequest.java`** (신규): `record FixedSlotRequest(@NotNull UUID placeId, @NotNull @Min(1) Integer dayNumber)`.
- **`entity/RouteSlot.java`**: 고정 슬롯 생성 경로만 별도로 `pinned=true`를 세팅할 수 있는 정적 팩토리 `RouteSlot.createFixed(...)` 추가(기존 `builder()`는 스트리밍 저장용으로 그대로 둠, 신규 팩토리로 관심사 분리. 기존 생성자는 항상 `pinned=false`로 시작해 이 팩토리가 없으면 고정 슬롯을 만들 수 없음).
- **`service/RouteSlotService.java`**:
  - `createFixedSlots(UUID routeId, List<FixedSlotRequest> fixedSlots)` 신규 — `placeId` 존재 검증(`PlaceRepository`) 후 `RouteSlot.createFixed(...)` 형태로 저장(order_index는 day별로 겹치지 않는 큰 임시값 — 실제 값은 곧 `applyFixedSlotResult()`가 덮어씀). `dayNumber`가 여행 박수(`req.nights()+1`) 범위를 벗어나면 `BusinessException(ErrorCode.INVALID_SLOT_ORDER)`(기존 코드 재사용 — 상세보기 재정렬 때 추가한 것과 같은 검증 성격).
  - `saveStreamingLine(UUID routeId, String jsonLine)` 수정 — `"is_fixed": true`인 라인이면 `applyFixedSlotResult(routeId, node)`로 분기, 아니면 기존 `saveStreamingSlot()` 그대로.
  - `applyFixedSlotResult(UUID routeId, JsonNode node)` 신규 — `route_id + day_number + place_id`로 기존 pinned `RouteSlot` 조회 후 `order_index`/`start_time`/`updateTransport(...)` 갱신(INSERT 아님, 기존 `RouteSlot.updateTransport()`/`updateStartTime()`/`updateOrderIndex()` 재사용 — "상세보기 슬롯 재정렬"에서 이미 추가한 메서드들).
- **`controller/RouteController.java`**: `generate()`에서 `routeSlotService.createFixedSlots(route.getId(), req.fixedSlotsOrEmpty())`를 `createRoute()` 직후·스트리밍 시작 전에 호출. 그 외 스트리밍 라인 처리 흐름은 그대로(분기는 `RouteSlotService.saveStreamingLine()` 내부에서 처리).
- **`service/AiServiceClient.java`**: `FastApiRequest`에 고정 슬롯 정보 추가 — 숙소 앵커(`AccommodationAnchorDto`)와 동일하게 day_number + place의 lat/lng을 FastAPI가 바로 쓸 수 있는 형태로 변환해서 전달(place 좌표 조회는 `PlaceRepository` 재사용).

### FastAPI (`ai/`)

- **`app/models/schemas.py`**: `RouteGenRequest`에 `fixed_slots: list[FixedSlot] = []` 필드 추가. `FixedSlot(place_id, day_number, lat, lng)` 신규 모델(장소명 등은 이미 place_id로 DB에 있으니 좌표만 필요).
- **`app/services/route_service.py`**:
  - `_build_fixed_slots_by_day(fixed_slots)` 신규 헬퍼 — day_number → 그 날 고정된 place_id 집합 + 좌표 리스트로 매핑(`_build_accommodation_anchors`와 같은 형태의 순수 함수).
  - day별 프롬프트 생성 구간(`day_candidate_lookup` 빌드하는 부분, L250 근처): 그 day에 이미 고정된 place_id를 후보에서 제외.
  - `slot_cap` 계산 구간(L322 근처): 그 day의 고정 슬롯 개수만큼 차감(`slot_cap - len(fixed_for_day)`, 최소 0).
  - `_finalize_day()`(L324): `reorder_slots()` 호출 전에 그 day의 고정 슬롯을 최소 라인(`{"place_id": ..., "day": N, "is_fixed": true}`)으로 만들어 `day_lines`에 합류. `reorder_slots()`→`enrich_transport()`→`_assign_start_times()`까지 기존 파이프라인을 그대로 통과(고정 슬롯이 없는 day는 기존과 100% 동일 동작). 최종 출력 라인마다 원래 `is_fixed` 플래그를 유지해서 내보냄(AI 슬롯은 필드 자체가 없거나 `false`).
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

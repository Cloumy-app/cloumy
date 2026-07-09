# 공유 루트 가져오기 설계

## 배경

["사전 고정(pinned) 슬롯 기반 설계"](./2026-07-09-fixed-anchor-slots-foundation-design.md)에서 만든 `fixedSlots` 계약을 실제로 채우는 첫 번째 기능이다. 유저가 루트를 새로 만들기 전, 다른 유저가 공개한 루트를 둘러보고 마음에 드는 장소만 개별로 골라서(day 지정 포함) 내 새 루트의 "이미 확정된 일정"으로 가져온다.

조사 결과 두 가지가 이미 스키마에 있지만 실제로는 전혀 안 쓰이고 있었다:
- `routes.is_public` — 폴백(유사 루트 추천)에서 읽기만 하고, 유저가 직접 켤 수 있는 UI/API가 없음
- `routes.save_count` — "몇 명이 이 루트를 가져갔는지" 세는 용도로 보이는 컬럼인데 증가시키는 코드가 전혀 없음

이번 스펙에서 이 두 개를 실제로 연결한다.

## 범위

**포함**:
- 내 루트를 공개로 켜고 끄는 토글(API + 상세보기 헤더 UI)
- 목적지가 일치하는 공개 루트 브라우징(목록 + 상세 슬롯 조회) — 소유자 전용 기존 엔드포인트는 건드리지 않고 별도 read-only 엔드포인트 신설
- 루트 생성 위저드에 "공유 루트에서 가져오기(선택)" 스텝 신규 추가 — 개별 장소 체크박스(전체선택 포함) + day 직접 지정
- 가져온 장소를 기반 스펙의 `fixedSlots`로 변환해 생성 요청에 포함, 원본 루트의 `save_count` 증가

**제외**:
- 하루 전체·루트 전체 단위 가져오기(개별 장소 단위만, 브레인스토밍에서 이미 결정)
- 콘서트·이벤트 앵커 — 다음 스펙
- 공개 루트에 대한 신고/모더레이션, 비공개 전환 시 이미 가져가진 슬롯 소급 처리 — 이번 스코프 밖(가져온 순간의 스냅샷이 새 루트에 복사되므로 원본이 나중에 비공개로 바뀌어도 이미 가져온 슬롯엔 영향 없음)
- 홈/탐색 탭에 공개 루트 피드 노출 — `explore.tsx` 자체가 플레이스홀더라 이번엔 생성 위저드 안에서만 접근 가능하게 한정(브레인스토밍에서 결정한 스코프)

## 핵심 변경

**데이터 흐름**:

```
1. 루트 소유자: route/[routeId]/index.tsx 헤더의 공유 아이콘 탭
   → PATCH /v1/routes/{routeId}/visibility { isPublic: true }
   → is_public=true로 저장

2. 새 루트를 만들려는 유저: route/create/step-1.tsx에서 목적지·날짜 입력 후
   → route/create/import-slots.tsx(신규, 선택 스텝)
   → GET /v1/routes/public?destination=X
     (목적지 일치 + is_public=true + 요청자 본인 루트는 자동 제외, save_count DESC 정렬)
   → 리스트에서 루트 하나 선택 → GET /v1/routes/{routeId}/public-slots
     (그 루트가 is_public=true일 때만 슬롯 목록 반환, day별로 그룹 표시)
   → 체크박스로 장소 선택(전체선택 토글 포함) + 선택한 장소마다
     새 여행의 며칠차인지 드롭다운으로 직접 지정
   → 선택 결과를 useImportedSlotsStore(Zustand)에 축적
     (여러 공개 루트에서 반복 선택 가능 — 스토어에 계속 append)

3. step-4(기존 숙소 입력 스텝)에서 "생성하기" 트리거 시:
   → useImportedSlotsStore의 항목들을
     fixedSlots: [{ placeId, dayNumber }], sourceRouteIds: [...]로 변환
   → POST /v1/routes/generate 요청에 실어 보냄
     (fixedSlots 처리는 기반 스펙 그대로 — 이 스펙에서 새로 만들 것 없음)

4. RouteService.createRoute() 성공 후:
   → sourceRouteIds에 담긴 각 루트의 save_count += 1
     (같은 루트에서 여러 장소를 가져와도 그 루트 기준 1루트=1가져오기로 세서
      "몇 명이 이 루트를 가져갔는지"라는 원래 컬럼 의도에 맞춤 — 장소 개수만큼
      중복 카운트하지 않음)
```

**접근 제어 원칙**: 기존 `verifyOwner()`(소유자 전용) 엔드포인트는 그대로 두고, "공개 루트 열람"은 완전히 별도 메서드/엔드포인트로 분리한다. 기존 엔드포인트에 `isPublic || owner` 조건을 끼워 넣는 방식은 나중에 실수로 조건을 잘못 바꾸면 사생활 루트가 새어나갈 위험이 있어, 아예 코드 경로를 나누는 쪽이 안전하다.

## 파일별 변경 사항

### Spring (`backend/`)

- **`dto/UpdateVisibilityRequest.java`** (신규): `record UpdateVisibilityRequest(@NotNull Boolean isPublic)`.
- **`dto/PublicRouteListResponse.java`** (신규): `record PublicRouteListResponse(UUID id, String title, String destination, int nights, String[] tags, int saveCount)` — `RouteListResponse`와 별도 유지(기존 "내 루트 목록" 응답 모양을 안 건드림).
- **`entity/Route.java`**: `updateVisibility(boolean isPublic)`, `incrementSaveCount()` 메서드 추가(각각 단순 필드 갱신 — 기존 `togglePin()` 같은 패턴).
- **`repository/RouteRepository.java`**: `findByDestinationAndIsPublicTrueAndUserIdNot(String destination, UUID excludeUserId, Pageable)` 추가(목적지 일치 + 공개 + 본인 제외, `save_count DESC` 정렬은 `Pageable`의 `Sort`로).
- **`service/RouteService.java`**:
  - `updateVisibility(UUID routeId, UUID userId, boolean isPublic)` 신규 — 소유자 검증 후 토글(기존 `verifyOwner` 패턴과 동일하게 소유자만 가능).
  - `getPublicRoutes(String destination, UUID requesterId, Pageable)` 신규 — 소유자 검증 없음(공개 열람이므로), `excludeUserId=requesterId`로 본인 루트 제외.
  - `incrementSaveCounts(List<UUID> routeIds)` 신규 — `createRoute()` 성공 트랜잭션 안에서 호출(기반 스펙의 `fixedSlots` 처리와 같은 요청 흐름 안).
- **`service/RouteSlotService.java`**: `getPublicSlots(UUID routeId)` 신규 — `verifyOwner` 대신 "route.isPublic()이 아니면 `ROUTE_ACCESS_DENIED`"만 확인(유저 인증 자체는 필요하지만 소유자일 필요는 없음).
- **`controller/RouteController.java`**: `PATCH /routes/{routeId}/visibility`, `GET /routes/public` 추가.
- **`controller/RouteSlotController.java`**: `GET /routes/{routeId}/public-slots` 추가(같은 클래스, 기존 소유자 전용 `GET /routes/{routeId}/slots`와는 별도 메서드).
- **`dto/RouteGenRequest.java`**: `sourceRouteIds: List<UUID>` 필드 추가(nullable, `fixedSlots`와 세트로 프론트가 함께 보냄 — AI 생성 파이프라인에는 전달 안 하고 `save_count` 증가 용도로만 Spring 레이어에서 소비).

### Frontend

- **`app/route/create/import-slots.tsx`** (신규): 목적지 일치 공개 루트 목록 → 선택 시 그 루트의 day별 슬롯 체크리스트(전체선택 토글) + day 지정 드롭다운. "건너뛰기" 가능(선택 사항 스텝).
- **`stores/useImportedSlotsStore.ts`** (신규): `useAccommodationPinStore`와 동일한 목적(스텝 간 역방향 데이터 전달용) — `{ placeId, placeName, dayNumber, sourceRouteId }[]` 배열, `add`/`remove`/`clear`.
- **`app/route/create/step-1.tsx`**: 다음 스텝 라우팅을 `step-2`에서 `import-slots`로 변경(그 뒤 기존 step-2로 이어짐).
- **`app/route/create/step-4.tsx`**: `streamRoute()` 호출부에 `useImportedSlotsStore`의 항목을 `fixedSlots`/`sourceRouteIds`로 변환해 포함.
- **`app/route/[routeId]/index.tsx`**: 헤더에 공유 토글 아이콘 추가(기존 예산 아이콘 옆) — `isNewRoute`일 때는 숨김(저장 전 루트는 공유 대상 아님).
- **`lib/api/routes.ts`**: `updateRouteVisibility()`, `getPublicRoutes()`, `getPublicRouteSlots()` 추가.
- **`lib/i18n/locales/{ko,en,ja,zh}.json`**: `routeCreateImport.*`(스텝 제목·전체선택·건너뛰기 등), `routeResult.shareOnLabel/shareOffLabel` 키 추가.

## 에러 처리

| 상황 | 처리 |
|---|---|
| 비공개 루트의 `/public-slots` 조회 | 403 `ROUTE_ACCESS_DENIED` |
| 존재하지 않는 routeId로 visibility 토글 | 404 `ROUTE_NOT_FOUND` |
| 소유자 아닌 유저가 visibility 토글 시도 | 403 `ROUTE_ACCESS_DENIED`(기존 `verifyOwner` 패턴 재사용) |
| 목적지 일치하는 공개 루트 0건 | 빈 리스트 응답(에러 아님) — 프론트는 "아직 공유된 루트가 없어요" 빈 상태 + 스텝 스킵 유도 |
| 가져온 장소의 day가 새 여행 박수 범위 밖 | 프론트 드롭다운 자체를 새 여행 박수만큼만 노출해 원천 차단. 그래도 넘어오면 기반 스펙의 기존 `INVALID_SLOT_ORDER` 검증이 최종 방어선 |
| `sourceRouteIds`에 이미 삭제된 routeId 포함 | `incrementSaveCounts`에서 조용히 스킵(존재하는 것만 갱신) — 카운트 실패가 루트 생성 자체를 막을 이유 없음 |

## 검증 방법

```bash
# 1. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 2. 공유 토글
curl -X PATCH http://localhost:8090/v1/routes/{routeId}/visibility \
  -H "Authorization: Bearer $TOKEN_OWNER" -H "Content-Type: application/json" \
  -d '{"isPublic": true}'
# 기대: 200, DB에서 is_public=true 확인

# 3. 다른 유저로 공개 목록 조회
curl "http://localhost:8090/v1/routes/public?destination=서울" \
  -H "Authorization: Bearer $TOKEN_OTHER"
# 기대: 방금 공개한 루트가 목록에 포함, save_count=0

# 4. 다른 유저로 공개 슬롯 조회 (소유자 아니어도 200)
curl http://localhost:8090/v1/routes/{routeId}/public-slots \
  -H "Authorization: Bearer $TOKEN_OTHER"
# 기대: 200 + 슬롯 목록. 같은 routeId를 기존 GET /slots(소유자 전용)로 $TOKEN_OTHER로
# 호출하면 여전히 403인지도 같이 확인(접근 제어 분리가 제대로 됐는지)

# 5. fixedSlots + sourceRouteIds로 새 루트 생성 후 원본 루트 save_count 재조회
# → 1 증가했는지 확인

# 6. 프론트 타입체크
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0

# 7. 수동 검증 (npx expo run:ios)
#  - 루트 상세보기에서 공유 토글 켜기/끄기
#  - 새 루트 생성 위저드에서 import-slots 스텝 진입 → 목록/체크박스/day지정/건너뛰기 동작
#  - 생성된 루트에 가져온 장소가 is_pinned=true로 포함돼 있는지 확인
```

# 루트/커뮤니티 탭 신설 설계

## 배경

["공유 루트 가져오기"](./2026-07-09-shared-route-import-design.md)에서 `routes.is_public`/`save_count`를 실제로 연결했지만, 그 스펙은 "홈/탐색 탭에 공개 루트 피드 노출"을 명시적으로 스코프 밖으로 뒀다(`explore.tsx`가 당시 플레이스홀더였기 때문 — 지금은 [탐색 탭](./2026-07-10-explore-tab-design.md)으로 이미 구현됨). 이번 스펙이 그 후속으로, 공개 루트를 생성 위저드 안에서만 보는 게 아니라 독립된 탭에서 둘러보는 기능을 만든다.

또한 지금까지 "루트"는 AI 생성(`route/create` 위저드)으로만 만들 수 있었는데, 유저가 이미 다녀온 여행을 손수 입력해서 공유하고 싶다는 요구가 있어 수동 작성 경로도 함께 추가한다.

현재 하단 탭바는 홈·탐색·AI챗봇·프로필 4개이고, 내 루트 목록(`app/routes/index.tsx`)은 홈 화면에서 스택으로 진입하는 서브 화면으로 이미 완성돼 있다(카드, 스와이프 삭제, 재정렬, 새 루트 만들기).

## 범위

**포함**:
- 하단 탭바에 "루트"·"커뮤니티" 탭 추가(홈·탐색·루트·AI챗봇·커뮤니티·프로필 순)
- 기존 `app/routes/index.tsx`(내 루트 목록)를 탭 화면으로 이동
- 커뮤니티 탭: 목적지 무관 전체 공개 루트 피드(무한 스크롤, `save_count` 내림차순)
- 커뮤니티 피드 카드 탭 → 읽기전용 미리보기(Day탭 + 장소 목록)
- 미리보기에서 "전체 가져오기"(날짜만 새로 받아 통째로 복제해 내 루트에 즉시 추가) / "선택해서 가져오기"(기존 `route/create` 위저드로 이동, 이 루트가 이미 열린 상태로 `import-slots` 진입)
- 커뮤니티 탭에서 "루트 올리기" → 제목/목적지/날짜/장소(검색+Day지정) 직접 입력 후 공개 루트로 즉시 생성
- 백엔드: `GET /v1/routes/public`의 `destination` 파라미터 옵셔널화, 루트 복제 엔드포인트, 수동 루트 생성 엔드포인트

**제외**:
- 좋아요·댓글·팔로우 등 소셜 기능 — 이번엔 저장(가져오기) 수 하나로 충분(브레인스토밍에서 결정)
- 작성자 표시(닉네임/프로필) — `PublicRouteResponse`에 유저 정보 자체가 없고, 이번 스코프는 "루트 발견"이지 "누가 썼는지"가 아님
- 신고/모더레이션 — 수동 작성 루트가 늘면 필요해지겠지만 이번엔 스코프 밖
- 목적지별 필터/검색(탭 진입 시 도시 선택) — 이번엔 전체 통합 피드만(브레인스토밍에서 전체 피드로 확정)
- "선택해서 가져오기"에서 기존 내 루트에 슬롯 추가 — 이번엔 신규 루트 생성 흐름에만 연결(기존 `import-slots` 재사용 범위 그대로)
- 수동 루트의 groupType/budgetLevel을 유저가 직접 고르는 UI — 내부 기본값(`solo`/`mid`/`normal`)으로 고정, 폼에 노출 안 함(브레인스토밍에서 승인된 폼 필드에 없음)

## 핵심 변경

### 1. 루트 탭 (기존 화면 이동)

```
app/routes/index.tsx → app/(tabs)/routes.tsx
- 상단 "< 뒤로가기" 화살표 제거(탭 루트 화면이라 back 대상이 없음)
- 나머지 로직(useQuery, 스와이프 삭제, 재정렬, 새 루트 만들기 버튼) 그대로 유지
- URL 경로는 그룹 디렉터리라 동일("/routes") — 홈 화면의 "전체보기" 버튼(router.push('/routes'))은 수정 불필요
```

### 2. 커뮤니티 피드

```
1. app/(tabs)/community.tsx 진입
   → GET /v1/routes/public?page=0&size=10 (destination 파라미터 생략)
     (is_public=true + 요청자 본인 제외, save_count DESC, 무한 스크롤로 다음 페이지 로드)
   → 카드: 제목·목적지·박수·태그·저장수

2. 카드 탭 → app/community/[routeId]/index.tsx (신규, 읽기전용 미리보기)
   → GET /v1/routes/{routeId}/public-slots (기존 엔드포인트 그대로 재사용)
   → Day탭 + 장소 목록만 표시(지도·날씨·예산·편집 기능 없음)

3-A. "전체 가져오기" 버튼
   → 출발일만 고르는 간단한 날짜 모달(박수는 원본 고정값 표시, 종료일은 자동 계산)
   → POST /v1/routes/{routeId}/clone { startDate }
   → 성공 시 내 루트 탭으로 이동, 원본 save_count +1

3-B. "선택해서 가져오기" 버튼
   → route/create/step-1로 이동(목적지는 이 루트의 destination으로 프리필)
   → 새 날짜·인원 설정 후 import-slots 화면 진입 시 "공개 루트 목록" 단계를 건너뛰고
     바로 이 routeId가 열린 상태(장소 체크박스 + Day칩)로 시작
   → 이후 흐름은 기존 공유 루트 가져오기 스펙 그대로(useImportedSlotsStore → step-4에서 생성)
```

**전체 가져오기가 날짜만 새로 받는 이유**: 슬롯의 `day_number`가 원본 박수 기준으로 이미 확정돼 있다. 새 박수를 자유롭게 고르게 하면 원본보다 짧을 때 여러 날의 슬롯을 어느 한 날짜로 뭉개거나 잘라내야 하는 클램핑 로직이 필요해진다(기존 `import-slots.tsx`가 개별 장소 단위라 클램핑이 자연스러웠던 것과 달리, 전체 복제는 구조 자체를 유지해야 의미가 있음). 그래서 이번엔 박수를 원본 그대로 고정하고 시작일만 받는다 — 새 날짜가 필요한 이유(과거 여행이었을 수 있음)는 충족하면서 클램핑 문제를 원천 차단.

### 3. 수동 루트 작성

```
app/community/create.tsx (신규)
- 제목: 텍스트 입력
- 목적지: 텍스트 입력(route/create/step-1과 동일 패턴, 자유 텍스트)
- 날짜 범위: DateTimePicker(step-1과 동일 컴포넌트) → nights 자동 계산
- 장소 추가: 기존 SearchPlaceTab 컴포넌트 재사용
  (카카오 검색 → resolveExternalPlace로 placeId 확정 → Day칩으로 day 지정
   → useImportedSlotsStore에 추가 — 기존 스토어/컴포넌트를 그대로 재사용,
   위저드 전용이 아니라 "장소 선택 + day 지정"이라는 목적 자체가 동일하기 때문)
- 추가된 장소 목록을 Day별로 그룹핑해 보여주고 각 항목에 삭제 버튼
- "공개로 올리기" → POST /v1/routes/manual
  { title, destination, startDate, endDate,
    slots: [{ placeId, dayNumber }] (화면에 보이는 순서가 각 day 안에서의 orderIndex) }
  → 성공 시 useImportedSlotsStore.clear() + 커뮤니티 피드로 이동
```

## 파일별 변경 사항

### Spring (`backend/`)

- **`controller/RouteController.java`**:
  - `getPublicRoutes`의 `@RequestParam String destination` → `@RequestParam(required = false) String destination`
  - `POST /routes/{routeId}/clone` 추가 — `RouteCloneRequest` 바디, `RouteService.cloneRoute()` 호출
  - `POST /routes/manual` 추가 — `ManualRouteCreateRequest` 바디, `RouteService.createManualRoute()` 호출
- **`dto/RouteCloneRequest.java`** (신규): `record RouteCloneRequest(@NotNull LocalDate startDate)`
- **`dto/ManualRouteCreateRequest.java`** (신규): `record ManualRouteCreateRequest(@NotBlank String title, @NotBlank String destination, @NotNull LocalDate startDate, @NotNull LocalDate endDate, @NotEmpty List<ManualSlotRequest> slots)`, `record ManualSlotRequest(@NotNull UUID placeId, @Min(1) int dayNumber)`
- **`repository/RouteRepository.java`**:
  - `findByIsPublicTrueAndUserIdNot(UUID userId, Pageable pageable)` 추가(destination 조건 없이 전체 공개 루트, 본인 제외)
- **`service/RouteService.java`**:
  - `getPublicRoutes(String destination, UUID requesterId, Pageable)`: `destination == null`이면 신규 리포지토리 메서드로 분기, 있으면 기존 메서드 유지
  - `cloneRoute(UUID routeId, UUID userId, LocalDate startDate)` 신규:
    - 원본 조회 → `isPublic()`이 아니면 `ROUTE_ACCESS_DENIED`
    - `endDate = startDate.plusDays(original.getNights())`
    - `Route.builder()`로 title·destination·nights·groupType·budgetLevel·tags·density를 원본에서 그대로 복사, `userId`만 새로 지정
    - 저장 후 `routeSlotService.cloneSlots(originalRouteId, newRouteId)` 호출(같은 트랜잭션)
    - `original.incrementSaveCount()`
  - `createManualRoute(ManualRouteCreateRequest req, UUID userId)` 신규:
    - `Route.builder()`로 생성, `groupType="solo"`, `budgetLevel="mid"`, `density="normal"` 고정값, `nights = ChronoUnit.DAYS.between(startDate, endDate)`
    - 저장 직후 `route.updateVisibility(true)`(별도 토글 단계 없이 바로 공개)
    - `routeSlotService.createManualSlots(routeId, req.slots())` 호출
- **`service/RouteSlotService.java`**:
  - `cloneSlots(UUID sourceRouteId, UUID targetRouteId)` 신규 — `routeSlotRepository.findByRouteIdOrderByDayNumberAscOrderIndexAsc(sourceRouteId)`를 순회하며 `place_id/day_number/order_index/duration_minutes/estimated_cost/tips/transport_*` 그대로 복사한 새 `RouteSlot`을 저장(시간 재계산 없이 스냅샷 그대로 — 원본과 동일한 일정 구조를 보존하는 게 목적)
  - `createManualSlots(UUID routeId, List<ManualSlotRequest> slots)` 신규 — day별로 그룹핑해 `orderIndex`를 0부터 재부여(요청 리스트 안에서 같은 day끼리의 상대 순서를 유지), `RouteSlot.builder()`로 저장(시간·비용·이동정보는 전부 null — 수동 입력 스코프 밖)
- **`repository/RouteSlotRepository.java`**: `findSlotsByRouteId`는 `SlotProjection` 반환이라 복제 시 엔티티 필드(특히 `place_id` UUID, `transport_*`)를 그대로 복사하기엔 부적합 — `List<RouteSlot> findByRouteIdOrderByDayNumberAscOrderIndexAsc(UUID routeId)` 신규 추가(엔티티 그대로 반환)

### Frontend

- **`app/(tabs)/_layout.tsx`**: `Tabs.Screen name="routes"`, `name="community"` 추가(순서: index·explore·routes·chat·community·profile), 아이콘은 `Map`(루트)·`Users`(커뮤니티) — `lucide-react-native`에서 import
- **`app/routes/index.tsx` → `app/(tabs)/routes.tsx`**: 파일 이동, 헤더의 뒤로가기 `TouchableOpacity`/`ChevronLeft` 제거
- **`app/(tabs)/community.tsx`** (신규): 피드 리스트(무한 스크롤), 상단 "루트 올리기" 버튼
- **`app/community/[routeId]/index.tsx`** (신규): 읽기전용 미리보기 — `import-slots.tsx`의 "루트 열기" 뷰(Day탭 + 슬롯 목록 렌더링) 패턴을 별도 컴포넌트로 뽑아 재사용하거나 유사 구조로 새로 작성, "전체 가져오기"/"선택해서 가져오기" 버튼
- **`app/community/create.tsx`** (신규): 수동 루트 작성 폼
- **`app/route/create/step-1.tsx`**: `destination` 쿼리 파라미터로 프리필 받는 옵션 추가(선택해서 가져오기 진입 시 사용)
- **`app/route/create/import-slots.tsx`**: `sourceRouteId` 파라미터가 있으면 "공개 루트 목록" 단계를 건너뛰고 바로 `onOpenRoute()` 상당의 상세 뷰로 시작하도록 분기 추가
- **`lib/api/routes.ts`**:
  - `getPublicRoutes(destination?: string, page = 0, size = 10)`로 시그니처 변경(destination 옵셔널, 페이지네이션 파라미터 추가)
  - `cloneRoute(routeId: string, startDate: string)` 추가
  - `createManualRoute(payload)` 추가
- **`lib/i18n/locales/{ko,en,ja,zh}.json`**: `community.*`(탭 타이틀, 피드 빈 상태, 루트 올리기 버튼 등), `communityPreview.*`(전체/선택 가져오기 버튼, 날짜 모달), `communityCreate.*`(폼 라벨) 키 추가

## 에러 처리

| 상황 | 처리 |
|---|---|
| 비공개 루트를 clone 시도 | 403 `ROUTE_ACCESS_DENIED` |
| 존재하지 않는 routeId로 clone/미리보기 조회 | 404 `ROUTE_NOT_FOUND` |
| 수동 루트 생성 시 `slots` 빈 배열 | 400 — `@NotEmpty` 검증으로 컨트롤러 단에서 차단 |
| 수동 루트 생성 시 `endDate <= startDate` | 400 `INVALID_INPUT`(숙소 체크인/아웃 검증과 동일 패턴) |
| 수동 루트 생성 시 `dayNumber`가 계산된 nights+1 범위 밖 | 400 `INVALID_INPUT` — 프론트 Day칩이 날짜 범위만큼만 노출해 원천 차단, 서버는 최종 방어선 |
| 커뮤니티 피드 0건 | 빈 리스트 응답(에러 아님) — "아직 공유된 루트가 없어요" 빈 상태 |
| clone 중 원본이 이미 삭제됨(동시성) | `findById` 실패로 자연스럽게 404 `ROUTE_NOT_FOUND` |

## 검증 방법

```bash
# 1. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 2. 전체 피드 조회 (destination 없이)
curl "http://localhost:8090/v1/routes/public?page=0&size=10" \
  -H "Authorization: Bearer $TOKEN"
# 기대: 200, 여러 목적지가 섞인 공개 루트 목록, save_count DESC 정렬

# 3. 전체 가져오기
curl -X POST http://localhost:8090/v1/routes/{routeId}/clone \
  -H "Authorization: Bearer $TOKEN_OTHER" -H "Content-Type: application/json" \
  -d '{"startDate": "2026-09-01"}'
# 기대: 200 + 새 routeId, 슬롯 개수가 원본과 동일한지, endDate가 nights만큼 정확히 계산됐는지 확인
# 원본 조회 시 save_count +1 확인

# 4. 비공개 루트 clone 시도
# 기대: 403 ROUTE_ACCESS_DENIED

# 5. 수동 루트 생성
curl -X POST http://localhost:8090/v1/routes/manual \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"나만의 도쿄 여행","destination":"도쿄","startDate":"2026-08-01","endDate":"2026-08-03","slots":[{"placeId":"...","dayNumber":1}]}'
# 기대: 200, DB에서 is_public=true로 즉시 생성 확인, 내 루트 탭/커뮤니티 피드 양쪽에 노출되는지 확인

# 6. 프론트 타입체크
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0

# 7. 수동 검증 (npx expo run:ios)
#  - 탭바에 루트·커뮤니티 순서/아이콘 확인, 루트 탭이 뒤로가기 없이 정상 진입되는지
#  - 커뮤니티 피드 무한 스크롤, 카드 탭 → 미리보기 → 전체/선택 가져오기 각각 동작
#  - 루트 올리기 폼으로 장소 여러 개 + 여러 Day에 걸쳐 입력 후 공개 등록 → 커뮤니티 피드에 즉시 노출 확인
```

# 직접 장소 추가(카카오 검색) 설계

## 배경

"외부/수동 장소 처리 기반"(`POST /v1/places/external`)이 준비됐으니, 이제 유저가 아는 장소(맛집·카페 등)를 검색해서 직접 확정 슬롯으로 추가하는 기능을 만든다. 라이브 검색은 기존 팀 결정("커버리지·일관성 문제로 카카오 단일 소스 — TourAPI/네이버는 안 씀", `KakaoLocalClient.java` 주석)을 그대로 따라 카카오로 통일한다.

기존 카카오 검색(`KakaoLocalClient.searchAccommodation()`)은 `category_group_code=AD5`(숙박)로 하드코딩돼 있어 그대로 재사용할 수 없다 — 카테고리 필터 없는 일반 검색 경로가 새로 필요하다.

## 범위

**포함**:
- 카테고리 필터 없는 일반 카카오 장소 검색 (`GET /v1/places/search?keyword=`)
- 루트 생성 위저드의 기존 "공유 루트에서 가져오기"(`import-slots.tsx`) 화면에 "직접 검색" 탭 추가
- 검색 결과 선택 → day 지정 → 그 자리에서 `POST /v1/places/external`(기존, 재사용) 호출해 실제 placeId로 확정 → `useImportedSlotsStore`에 합류(공유 루트로 가져온 것과 동일 스토어)

**제외**:
- 상세보기(기존 루트)에서 장소를 직접 검색해 추가하는 기능 — 이번엔 생성 위저드에만. 필요해지면 별도 스펙.
- 지도 핀으로 좌표만 찍어서 추가하는 방식(숙소의 `accommodation-pin.tsx`처럼) — 이번엔 검색만.

## 핵심 변경

**데이터 흐름**:
```
1. import-slots.tsx 상단 탭: "공유 루트에서" | "직접 검색"

2. "직접 검색" 탭 선택 시:
   → 키워드 입력(디바운스 400ms, 기존 숙소 검색과 동일 UX)
   → GET /v1/places/search?keyword=... 호출 → 카테고리 무관 카카오 검색 결과
   → 결과 하나 선택 → day 칩 선택(기존 "공유 루트에서" 탭의 day 칩과 동일 UI)
   → day 확정 시 즉시 POST /v1/places/external
     { name, address, lat, lng, source: "kakao" } 호출 → 실제 placeId 획득
   → useImportedSlotsStore.addSlot({ placeId, placeName, dayNumber })
     (sourceRouteId 없음 — 원본 루트가 없는 경우이므로 옵셔널로 변경)

3. step-4.tsx 생성 트리거 시: 기존과 동일하게 스토어 전체를 fixedSlots로 변환.
   sourceRouteIds는 sourceRouteId가 있는 항목만 걸러서 구성(검색으로 추가된 항목은 자동 제외).
```

**왜 선택 즉시 find-or-create를 호출하는가**: 생성 시점까지 미루지 않고 바로 처리하면 (a) 같은 장소를 여러 번 검색해 추가해도 dedup이 바로 적용되고 (b) 화면이 항상 "이미 확정된 placeId"만 들고 있게 되어 스토어/변환 로직이 "가져오기"든 "검색"이든 완전히 동일한 shape로 통일된다.

**왜 같은 화면에 탭으로 넣는가**: 위저드가 이미 5단계인데 별도 스텝을 또 추가하면 더 길어진다. "확정 슬롯을 추가하는 방법이 두 가지(가져오기/검색)"일 뿐 목적은 동일해서, 하나의 스텝 안에서 방법만 고르게 하는 게 자연스럽다.

**왜 `KakaoLocalClient`를 리팩터링하는가**: `searchAccommodation()`과 신규 `searchPlace()`가 "카테고리 필터 유무"만 다르고 나머지 파싱 로직(좌표 없는 결과 스킵, road_address 우선)이 완전히 동일하다. 중복을 피하려고 공통 `search(keyword, categoryGroupCode)` private 메서드로 추출하고, 두 public 메서드는 그 위에 얇게 얹는다.

## 파일별 변경 사항

### Spring (`backend/`)

- **`service/KakaoLocalClient.java`**: `searchAccommodation()`/`searchPlace()` 공통 로직을 private `search(String keyword, String categoryGroupCode)`로 추출(`categoryGroupCode`가 null이면 URL에 파라미터 자체를 안 붙임 — 카카오 API 기본 동작이 전체 카테고리 검색). `searchAccommodation()`은 기존처럼 `LODGING_CATEGORY` 넘기도록 유지(회귀 없음). `searchPlace(String keyword)` 신규 — `search(keyword, null)`.
- **`service/PlaceService.java`**: `KakaoLocalClient` 의존성 추가, `searchPlaces(String keyword)` 신규 — `kakaoLocalClient.searchPlace(keyword)` 위임.
- **`controller/PlaceController.java`**: `GET /search?keyword=` 추가 — `List<KakaoPlaceDto>` 응답(기존 DTO 재사용, `AccommodationController.search()`와 동일한 응답 모양).

### Frontend (`frontend/`)

- **`lib/api/places.ts`**: `searchPlaces(keyword)` 추가 — `lib/api/accommodations.ts`의 기존 `KakaoPlaceResult` 타입을 그대로 import해서 재사용(중복 정의 안 함).
- **`stores/useImportedSlotsStore.ts`**: `ImportedSlot.sourceRouteId`를 `string`에서 `string | undefined`(옵셔널)로 변경 — 검색으로 추가된 항목은 원본 루트가 없음.
- **`components/route/SearchPlaceTab.tsx`** (신규) — 키워드 입력(디바운스) + 결과 리스트(기존 숙소 검색 UI 패턴 재사용) + 선택 후 day 칩(기존 import-slots.tsx의 day 칩 UI와 동일 패턴) + 확정 시 `resolveExternalPlace()` 호출 → `useImportedSlotsStore.addSlot()`. `dayCount`를 prop으로 받는다(호출부인 `import-slots.tsx`가 이미 계산해서 갖고 있음).
- **`app/route/create/import-slots.tsx`**: 상단에 탭 상태(`'import' | 'search'`) 추가, `'search'` 탭이면 `<SearchPlaceTab dayCount={dayCount} />` 렌더링. 기존 "공유 루트에서" 로직(리스트/상세 두 서브뷰)은 `'import'` 탭 안에 그대로 유지.
- **`app/route/create/step-4.tsx`**: `sourceRouteIds` 구성부를 `importedSlots.map(s => s.sourceRouteId)`에서 `importedSlots.map(s => s.sourceRouteId).filter((id): id is string => !!id)`로 변경(검색으로 추가된 undefined 항목 제외).
- **i18n**: `routeCreateImport.*`에 검색 탭 관련 키 추가(탭 라벨, 검색 placeholder, 결과 없음, 실패 안내 등) — 4개 로케일.

## 에러 처리

| 상황 | 처리 |
|---|---|
| 카카오 검색 결과 0건 | 빈 상태 안내(기존 숙소 검색과 동일 패턴 — "검색 결과가 없어요") |
| `resolveExternalPlace()` 실패(네트워크 등) | Alert 표시, 스토어에 추가 안 함 — 유저가 재시도 가능 |
| 카카오 API 자체 실패(서버측 `KAKAO_API_ERROR`) | 프론트는 빈 배열로 폴백(기존 `searchAccommodations()`와 동일 — `!res.ok`면 빈 배열 반환) |
| 좌표 없는 카카오 결과 | 방어적으로 스킵(기존 `search()` 로직 그대로 재사용) |
| 같은 장소를 검색+가져오기 양쪽에서 중복 추가 | 막지 않음(범위 밖) — `resolveExternalPlace()`의 find-or-create가 같은 placeId를 반환하긴 하지만, 스토어에 같은 placeId가 다른 day로 두 번 들어갈 수 있음. 실사용에서 드문 케이스라 이번엔 방지 로직 안 넣음. |

## 검증 방법

```bash
# 1. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 2. 일반 검색이 카테고리 무관하게 나오는지 확인 (예: 카페 검색)
curl "http://localhost:8080/v1/places/search?keyword=스타벅스" -H "Authorization: Bearer $TOKEN"
# → 카페 카테고리 결과 포함

# 3. 기존 숙소 검색이 여전히 숙박만 반환하는지 회귀 확인
curl "http://localhost:8080/v1/accommodations/search?keyword=강남" -H "Authorization: Bearer $TOKEN"
# → 숙박 카테고리만 반환(기존과 동일해야 함)

# 4. 프론트 타입체크
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0

# 5. 앱에서 수동 확인
#  - 위저드 import-slots 화면에서 "직접 검색" 탭 → 키워드 입력 → 결과 선택 → day 지정
#  - 생성 완료 후 해당 장소가 is_pinned=true로 지정한 day에 포함되는지 확인
```

## 다음 단계

이 기능이 승인되면:
1. 상세보기(기존 루트)에서도 직접 검색으로 장소 추가 — 필요해지면 별도 스펙(`insertSlotAfter`와 유사한 흐름이 될 것)
2. 콘서트 검색(Serper/KOPIS) 연동 시 이 스펙의 `resolveExternalPlace()` 호출 패턴을 그대로 재사용

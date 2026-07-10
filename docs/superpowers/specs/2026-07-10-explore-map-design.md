# 탐색 탭 지도 뷰 — 설계

## 배경

탐색 탭(PR #133)은 리스트 형태로만 장소를 보여준다. 장소들의 위치 관계를 한눈에 보기 어렵고,
북마크한 장소가 지도상 어디에 몰려있는지도 알 수 없다. 기존 루트 상세 화면(`TripMap`)에 이미
지도+마커+포커스 이동 패턴이 구축되어 있어 이를 재사용한다.

## 요구사항

1. 탐색 탭에서 지도와 리스트를 함께 보여준다.
2. 리스트의 장소 카드를 누르면 지도가 해당 장소로 이동한다.
3. 지도 마커는 북마크 여부에 따라 다르게 표시된다.
4. "내 북마크" 모드에서도 지도가 보인다(도시 구분 없이 전체 북마크 좌표 기준).

## 레이아웃

지도(상단, 고정 높이) + 리스트(하단, 스크롤) 분할 구조.
화면 하나에서 지도와 리스트를 동시에 볼 수 있고, 모드 전환 없이 바로 확인 가능.

```
┌─────────────────┐
│                 │
│      지도         │  ← 상단 고정, 마커 표시
│    (마커들)        │
├─────────────────┤
│  ▤ 장소 리스트      │
│  □ 카드 1          │  ← 스크롤 가능
│  □ 카드 2          │
└─────────────────┘
```

## 백엔드 변경

`/v1/places/browse`, `/v1/bookmarks` 응답에 `lat`/`lng`가 없어 마커를 찍을 수 없다.
기존 `findPlaceDetailById` 쿼리에서 이미 쓰는 패턴을 그대로 재사용한다:

- `PlaceRepository.browsePlaces` 네이티브 쿼리에 `ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng` 추가
- `PlaceBrowseProjection`에 `getLat()/getLng()` 추가
- `PlaceBrowseResponse`에 `lat`/`lng` 필드 추가 (프론트에는 지도 핀 좌표로만 쓰이고 화면에 숫자로 노출되지 않음)
- `ExploreService.getMyBookmarks()`의 수동 매핑 부분(`PlaceProjection` 기반)도 `p.getLat()/p.getLng()` 반영

## 프론트엔드 — `ExploreMap` 컴포넌트

`components/map/TripMap.tsx` 패턴을 재사용한 신규 컴포넌트 `components/explore/ExploreMap.tsx`.

- Props: `places: PlaceBrowseItem[]`, `focusedPlaceId: string | null`, `onMarkerPress: (placeId: string) => void`
- `places` 목록이 바뀌면(도시/테마 필터 변경, 북마크 모드 전환) `fitToCoordinates`로 전체 마커가 화면에 들어오게 범위 재조정
  - `TripMap`은 순차적인 루트라 `initialRegion`을 첫 슬롯 기준으로 잡지만, 탐색 결과는 도시 전역에 흩어져 있어 `fitToCoordinates`가 더 적합
- `focusedPlaceId`가 바뀌면 `animateToRegion`으로 해당 좌표로 이동(단일 핀 확대, delta 0.01 수준) — `TripMap`의 `focusedSlotId` 이펙트와 동일한 방식
- 마커 색상: 북마크된 장소는 강조색(rose, `PlaceBrowseCard`의 하트 활성 색 `#f43f5e`와 통일), 아닌 장소는 기본 강조색(sky, 앱 전반의 `sky-500`)
- 마커 탭 시 `onMarkerPress(place.id)` 호출 → 상세 시트 오픈
- `TripMap`처럼 유효 좌표(`lat !== 0`)만 필터링하는 방어 로직 유지(현재 스키마상 `location`이 NOT NULL이라 실질적으로 발생하지 않지만 기존 컨벤션과 일관성 유지)
- 지도 높이는 고정값(약 220~240px)

## explore.tsx 통합

- `focusedPlaceId` 로컬 state 추가
- 리스트 카드 탭: 기존처럼 `PlaceDetailSheet` 오픈 **+** `focusedPlaceId` 설정(지도 이동) — 기존 동작 유지, 지도 연동만 추가
- 마커 탭: `PlaceDetailSheet` 오픈 (카드 탭과 동일한 결과)
- "전체"/"내 북마크" 두 모드 모두 지도 표시, 각각 현재 리스트(`places`) 기준으로 `fitToCoordinates`

## 범위 밖

- 사용자의 현재 위치(GPS) 표시 — 이번 요청에 없음
- 지도 클러스터링 — 탐색 결과가 페이지당 50건으로 이미 제한되어 있어 불필요

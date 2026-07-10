# 공유 루트 가져오기 화면 — 북마크 기반 개편

## 배경

루트 생성 흐름의 "공유 루트에서 가져오기" 화면(`frontend/app/route/create/import-slots.tsx`)은 현재
2탭 구조다: "공유루트"(목적지 도시의 전체 공개 루트를 `save_count` 순으로 나열)와 "직접 검색"
(카카오 검색으로 새 장소를 바로 추가). 이걸 사용자가 미리 봐둔 루트/장소를 북마크해뒀다가 여기서
바로 골라 쓸 수 있게 바꾼다.

장소 북마크는 이미 구현돼 있다(`bookmarks` 테이블, `/v1/bookmarks` API, 탐색 탭). 루트 북마크는
전혀 없다 — `routes.save_count`는 유저별 북마크가 아니라 "이 루트에서 슬롯을 가져온 횟수" 집계일 뿐이다.

## 요구사항

1. "공유루트" 탭: 전체 공개 루트 목록은 유지하되, "전체"/"북마크" 토글을 추가하고 각 루트 카드에
   하트 아이콘을 달아 그 자리에서 루트를 북마크할 수 있게 한다(현재 앱에 루트를 둘러보는 화면이
   이 화면뿐이라, 북마크 진입점도 같은 화면에 있어야 함).
2. "북마크한 장소" 탭 신규 추가: 목적지 도시로 필터링된 내 북마크 장소 목록. 카드를 선택하면
   기존 "직접 검색" 탭의 day-picker와 동일한 방식으로 며칠차에 넣을지 고르고 확정한다.
3. "직접 검색" 탭: 카카오 검색으로 DB에 없는 새 장소를 추가하는 기존 기능이라 변경 없이 3번째 탭으로 유지.

## 데이터 모델

`bookmarks`(장소 북마크) 테이블과 동일한 구조로 `route_bookmarks` 테이블을 신설한다.

```sql
CREATE TABLE route_bookmarks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id    UUID        NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, route_id)
);
CREATE INDEX idx_route_bookmarks_user ON route_bookmarks(user_id, created_at DESC);
CREATE INDEX idx_route_bookmarks_route ON route_bookmarks(route_id);
```

## 백엔드 변경

### 공개 루트 목록 — 북마크 필터 + 상태 노출

`GET /v1/routes/public`에 `bookmarkedOnly`(기본 `false`) 파라미터를 추가한다. 기존
`RouteRepository.findByDestinationAndIsPublicTrueAndUserIdNot`(derived query)를 `PlaceRepository.browsePlaces`와
동일한 패턴의 네이티브 쿼리로 교체해 `isBookmarked`(EXISTS 서브쿼리)와 `bookmarkedOnly` 필터를 처리한다.

```java
@Query(value = """
        SELECT r.id::text AS id, r.title AS title, r.destination AS destination,
               r.nights AS nights, r.tags AS tags, r.save_count AS saveCount,
               EXISTS(SELECT 1 FROM route_bookmarks rb WHERE rb.route_id = r.id AND rb.user_id = :userId) AS isBookmarked
        FROM routes r
        WHERE r.destination = :destination AND r.is_public = true AND r.user_id != :userId
          AND (:bookmarkedOnly = false OR EXISTS(
                SELECT 1 FROM route_bookmarks rb2 WHERE rb2.route_id = r.id AND rb2.user_id = :userId))
        ORDER BY r.save_count DESC
        """,
        countQuery = "... 동일 WHERE 절 ...",
        nativeQuery = true)
Page<PublicRouteProjection> findPublicRoutes(destination, userId, bookmarkedOnly, pageable);
```

새 `PublicRouteProjection` 인터페이스(id/title/destination/nights/tags/saveCount/isBookmarked), `PublicRouteResponse`에
`isBookmarked` 필드 추가.

### 루트 북마크 추가/삭제

`ExploreController`/`ExploreService`의 장소 북마크와 동일한 패턴:
- `RouteBookmark` 엔티티(= `Bookmark.java` 구조 그대로, place_id 대신 route_id)
- `RouteBookmarkRepository`: `existsByUserIdAndRouteId`, `deleteByUserIdAndRouteId`
- `RouteService.addRouteBookmark(userId, routeId)` / `removeRouteBookmark(userId, routeId)`
- `RouteController`: `POST/DELETE /v1/routes/{routeId}/bookmark`

### 목적지 도시로 필터링된 북마크 장소

기존 `/v1/bookmarks`(도시 무관 전체 보기, 탐색 탭에서 사용 중)는 건드리지 않는다. 별도로
`BookmarkRepository`에 `bookmarks`와 `places`를 조인해 `ST_DWithin`으로 목적지 도시 30km 반경만 걸러내는
네이티브 쿼리를 추가하고, 새 엔드포인트 `GET /v1/bookmarks/by-city?city=서울`로 노출한다
(`ExploreService.browsePlaces`의 `CityCenters.COORDS` + `ST_DWithin` 패턴 재사용).

## 프론트엔드 변경 (`import-slots.tsx`)

- 탭 상태 타입을 `'import' | 'bookmarkedPlaces' | 'search'`로 확장, i18n 키 추가
  (`routeCreateImport.bookmarkedPlacesTab` 등)
- **공유루트 탭**: 탐색 탭과 동일한 "전체"/"북마크" 세그먼트 토글을 상단에 추가. 각 루트 카드에
  하트 아이콘 추가 — 눌러서 `POST/DELETE /v1/routes/{routeId}/bookmark` 호출, 장소 카드와 동일한
  낙관적 업데이트 패턴(`setQueryData` 먼저 반영 → 실패 시 `invalidateQueries`)
- **북마크한 장소 탭(신규)**: `GET /v1/bookmarks/by-city?city={destination}` 결과를 리스트로 표시.
  카드를 누르면 `SearchPlaceTab`의 day-picker(`pending` state + "며칠차에 넣을까요?" 칩) UI를 그대로
  재사용 — 이미 확정된 장소라 `resolveExternalPlace` 호출 없이 바로 `useImportedSlotsStore.addSlot({ placeId, placeName, dayNumber })`
- **직접 검색 탭**: 변경 없음

## 범위 밖

- 루트 상세 화면 등 이 화면 밖에서 루트를 둘러보고 북마크하는 별도 진입점 — 이번엔 이 화면 안의
  전체/북마크 토글로만 해결
- 장소 북마크(`/v1/bookmarks`)의 기존 도시 무관 조회 방식 변경 — 그대로 유지, 이번 변경은 완전히
  별도 엔드포인트로 추가

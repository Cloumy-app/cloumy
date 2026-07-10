# 탐색 탭(Discovery) — 장소 브라우징 + 북마크 설계

## 배경

`frontend/app/(tabs)/explore.tsx`("탐색" 탭, Compass 아이콘)는 현재 "탐색 기능 준비 중" 플레이스홀더다. `docs/01-prd.md`는 이 탭을 "Discovery 피드"라 부르며 취향 태그 시스템 재설계 논의(`2026-07-10-persona-tag-system-design.md`) 때 페르소나 태그의 소비처로 잠깐 언급됐을 뿐, 상세 스펙은 없었다. `planning/priorities.md` P0 표에는 "지도 탐색·북마크"(영구 무료 티어 기능)로 짧게 등장한다.

`bookmarks` 테이블은 `V3__create_routes.sql`에 이미 정의돼 있으나(user_id, place_id, unique 제약, FK CASCADE) 백엔드 코드가 전혀 없어 지금까지 한 번도 쓰인 적 없다.

Hidden Gems(GPS 인증 기반 커뮤니티, 희소성 점수)는 `planning/unimplemented.md`에 자금 확보 후 구현으로 명시적으로 연기돼 있어 이번 스코프에서 제외한다.

## 범위

**포함**:
- 도시 선택(드롭다운, `route/create/step-1.tsx`의 `CITIES` 재사용) → 해당 도시 반경 30km 내 큐레이션 장소 브라우징
- 테마 태그(9종, `step-2.tsx`의 `THEMES`) 필터 — 유저 `personaTags`를 테마로 역매핑해 기본 체크(기본값 제안, 강제 아님), 자유롭게 변경 가능
- 장소 북마크 추가/제거, 북마크 목록 조회
- 탐색 탭 내 "전체/내 북마크" 토글 + 프로필 화면에도 "내 북마크" 링크 — 둘 다 만들고 실사용 후 조정

**제외**:
- Hidden Gems(GPS 인증, 희소성 점수, 커뮤니티 배지) — 별도 항목, 자금 확보 후
- 장소 사진/이미지 — `places` 테이블에 이미지 URL 컬럼 자체가 없음, 카드는 텍스트 기반
- trend_score/rarity_score 기반 정렬 — Hidden Gems 연계 데이터라 이번엔 `review_count` 인기순만

## 핵심 설계 결정

**테마 필터는 `step-2.tsx`의 THEMES(9종)가 아니라 실제 `category_tags` 어휘(11종)를 그대로 쓴다.** 구현 중 `THEMES`(맛집·카페·관광·자연·쇼핑·문화·액티비티·힐링·야경)와 실제 DB 태그(`#식당·#먹방·#랜드마크·#뷰맛집·#액티비티·#실내·#역사·#쇼핑·#이벤트·#핫플·#카페`)가 3개(카페·쇼핑·액티비티)만 일치한다는 걸 발견했다 — 나머지 6개는 DB에 그 이름의 태그가 없어 필터가 사실상 무효화된다(자세한 배경은 `planning/unimplemented.md`의 "테마 태그 어휘 불일치" 항목 참고). 이 불일치는 route 생성·예산 자동조정·페르소나 자동추가까지 걸친 더 큰 이슈라 이번 스코프에서 통째로 고치지 않고, **탐색 탭만 실제 어휘를 직접 노출**해 우회한다.

페르소나 기본필터 매핑도 탐색 탭 전용으로 별도 작성한다: `K_FOOD_LOVER→먹방,식당`, `CAFE_HOPPER→카페`, `SHOPPING_MAVEN→쇼핑`, `CULTURE_EXPLORER→역사,랜드마크`, `NIGHT_OWL→핫플`(근사치 — Night Owl은 "야간 활동 선호"인데 핫플은 시간대 무관 "요즘 뜨는 곳"이라 완전히 일치하진 않음). `NATURE_SEEKER`는 대응 태그가 없어 매핑하지 않는다(다른 매핑 없는 페르소나와 동일 원칙).

**AI(FastAPI) 경유 없이 Spring이 PostGIS를 직접 쿼리한다.** `PlaceRepository.findNearbyPlaceIdByName`이 이미 `ST_DWithin` 네이티브 쿼리를 직접 쓰는 전례가 있고, 이번 기능은 "생성"이 아니라 "필터링된 조회"라 AI 서비스 호출을 추가할 이유가 없다.

**도시 좌표는 Java에 소규모로 복제한다.** `ai/app/config/city_centers.py`(14개 도시)와 동일한 값을 Spring 쪽 상수로 둔다. 정적이고 거의 안 바뀌는 값이라, 내부 서비스 호출을 새로 만드는 것보다 작은 중복이 낫다고 판단했다(페르소나 태그 매핑 때와 동일한 근거).

**반경 30km**로 통일 — 기존 `PostgisTagRetriever`의 `radius_m: int = 30000`과 일치시켜 "AI 루트 생성이 후보로 삼는 범위"와 "탐색 탭이 보여주는 범위"가 어긋나지 않게 한다.

**`bookmarks` 테이블은 그대로 사용, 신규 컬럼 없음** — 유니크 제약(`user_id, place_id`)이 이미 있어 멱등 추가가 자연스럽고 FK CASCADE로 유저/장소 삭제 시 자동 정리된다.

## 데이터 모델 & API 계약

기존 스키마 변경 없음(`bookmarks`, `places` 그대로 사용).

```
GET  /v1/places/browse?city=서울&tags=맛집,카페&page=0&size=20
     → 도시 좌표 반경 30km + category_tags 오버랩(tags 없으면 전체) + 페이지네이션
     → 응답에 요청 유저 기준 isBookmarked 포함(인증 필수 엔드포인트라 항상 userId 존재)
     → 정렬: review_count DESC NULLS LAST

POST   /v1/places/{placeId}/bookmark    → 북마크 추가(멱등 — 이미 있으면 그대로)
DELETE /v1/places/{placeId}/bookmark    → 북마크 제거(멱등 — 없어도 에러 아님)

GET  /v1/bookmarks?page=0&size=20       → 내 북마크 목록(탐색 탭 토글 + 프로필 링크 공용)
```

**응답 DTO** (`PlaceBrowseResponse`):
```java
record PlaceBrowseResponse(
    UUID id, String name, String address,
    List<String> categoryTags, boolean isHiddenGem, boolean isBookmarked
) {}
```

## 백엔드 컴포넌트

- **`com.cloumy.trip.controller.ExploreController`** (신규) — `GET /v1/places/browse`, `GET /v1/bookmarks`, `POST`/`DELETE /v1/places/{placeId}/bookmark`. `PlaceController`(장소 상세/검색/외부장소 전담)와 성격이 달라 분리.
- **`com.cloumy.trip.service.ExploreService`** (신규) — `browsePlaces`(도시→좌표 변환 후 `PlaceRepository` 위임), `toggleBookmark`, `getMyBookmarks`. 도시 좌표 상수(`CITY_CENTERS`, 14개) 보유, 없는 도시 요청 시 `BusinessException(INVALID_CITY)`.
- **`PlaceRepository`에 `browsePlaces` 네이티브 쿼리 추가** — `text[]` 오버랩은 `findSimilarRoutes`/`PersonaTagAutoAssignService`와 동일하게 `string_to_array` 캐스팅 패턴 재사용(`String[]` 직접 바인딩 불안정 문제 회피).
- **`com.cloumy.trip.repository.BookmarkRepository`** (신규) — `existsByUserIdAndPlaceId`, `deleteByUserIdAndPlaceId`, `findByUserIdOrderByCreatedAtDesc(Pageable)`.

## Frontend 구조

- **`app/(tabs)/explore.tsx`** (전면 재작성): 도시 드롭다운 + 테마 필터 칩(페르소나 기반 기본 체크) + "전체/내 북마크" 토글 + `FlatList`(TanStack Query `useInfiniteQuery`) + 카드 탭 시 기존 `PlaceDetailSheet` 재사용
- **`lib/api/explore.ts`** (신규): `browsePlaces`, `getMyBookmarks`, `toggleBookmark`
- **`components/explore/PlaceBrowseCard.tsx`** (신규): 이름·주소·category_tags 칩·북마크 토글(optimistic update)
- **`app/(tabs)/profile.tsx`**: "내 북마크" 링크 추가(기존 "내 루트" 섹션과 동일 스타일)
- **`app/bookmarks/index.tsx`** (신규): 프로필에서 진입하는 북마크 전용 화면, `PlaceBrowseCard` 재사용

## 에러 처리 & 엣지 케이스

- 목록에 없는 도시 문자열(오타·조작) → `BusinessException(INVALID_CITY)` 400
- 필터 결과 0건 → 프론트 빈 상태 UI("조건에 맞는 장소가 없어요"), 에러 아님
- 북마크 중복 추가/이미 없는 것 삭제 → 서비스에서 exists 체크 후 스킵, 유니크 제약 위반이 발생하지 않도록 방어
- 전체 엔드포인트 인증 필수 — 기존 `anyRequest().authenticated()` 정책 그대로 적용

## 테스트 전략

- `ExploreServiceTest`: 도시→좌표 변환 정확성, 없는 도시 예외, 북마크 토글 멱등성(중복 추가·중복 삭제 모두 에러 없음)
- PostGIS 실제 쿼리는 유닛 테스트로 커버하기 어려워 기존 프로젝트 관행대로 curl E2E로 검증
- Frontend는 실기기 수동 확인

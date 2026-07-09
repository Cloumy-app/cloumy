# 외부/수동 장소 처리 기반 설계

## 배경

"사전 고정(pinned) 슬롯 기반"(`fixedSlots`)은 `placeId`로 기존 `places` row를 참조하는 것을 전제로 설계됐다. 그런데 "공유 루트 가져오기"에 이어질 다음 기능들 — 콘서트·이벤트 앵커, 유저가 직접 아는 장소를 고정하는 기능 — 은 `places`에 없는 장소를 다뤄야 한다. 콘서트 검색(Serper+KOPIS)은 API 키가 아직 발급되지 않아 이번 스코프에서 제외하지만, "`places`에 없는 장소를 어떻게 확정 슬롯으로 편입시킬지"에 대한 공통 기반은 지금 마련해둔다.

기존 `places.source`(`tourapi`/`kakao`/`naver`/`hidden_gem`)는 출처와 무관하게 전부 배치로 태그·임베딩·`avg_duration_minutes`까지 채워진 뒤 들어간 데이터이고, AI 추천 리트리버(`PostgisTagRetriever`/`PgvectorRetriever`)는 `source`를 구분하지 않고 전부 후보로 조회한다. 반면 지금 숙소 검색이 쓰는 라이브 카카오 검색은 `places`에 아예 저장되지 않는다. 이번 설계는 이 둘 사이의 세 번째 경로 — **"`places`와 동일한 형태로 저장되지만, AI 추천 후보에는 절대 포함되지 않는" 최소 정보 장소**를 만든다.

## 범위

**포함**:
- `places.is_curated` 플래그 신설 — 배치 가공을 거친 기존 데이터는 `true`, 이번에 신설하는 경로로 들어간 최소 정보 장소는 `false`
- FastAPI 리트리버 2곳에 `is_curated = true` 필터 추가(route_service.py/slot_alternatives.py/chat_service.py 세 호출부 전부에 자동 적용됨)
- `POST /v1/places/external` — 이름/주소/좌표/출처를 받아 기존 장소를 찾거나(반경 50m + 이름 일치) 없으면 최소 정보로 신규 생성, `placeId` 반환(find-or-create)
- 반환된 `placeId`는 기존 `fixedSlots` 계약에 그대로 사용 가능(추가 변경 없음)
- 개발용 테스트 화면 1개(정식 기능 UI 아님)

**제외**:
- 콘서트 검색(Serper/KOPIS 연동) — API 키 발급 후 별도 스펙
- `is_curated=false` 장소를 큐레이션 팀이 검토해 승격시키는 워크플로우, 오래된 row 정리 — 데이터가 실제로 쌓인 뒤 필요하면 별도로 다룸
- "직접 장소 추가" 정식 유저 기능(위저드 통합, 지도 UI) — 이번엔 API+테스트 화면까지만

## 핵심 변경

**데이터 흐름**:
```
1. (콘서트 검색 결과 선택 / 카카오 라이브 검색 결과 선택 / 유저 직접 입력 — 호출부는 다를 수 있음)
   → POST /v1/places/external { name, address, lat, lng, source: "manual"|"kakao"|"event" }

2. PlaceService.resolveExternalPlace(req)
   → 반경 50m 이내 + 이름 일치(trim, 대소문자 무시)하는 기존 place 조회
     (is_curated 상관없이 — 이미 배치로 들어간 동일 장소가 있으면 그걸 재사용하는 게 더 좋은 데이터)
   → 있으면 그 id 그대로 반환
   → 없으면 accommodations.insertWithLocation()과 동일한 네이티브 INSERT 패턴으로
     최소 정보(name/address/location만, is_curated=false, avg_duration_minutes는 NULL)를 넣고 새 id 반환
     (avg_duration_minutes가 NULL이어도 createFixedSlots()가 이미 60분 기본값으로 채우므로 별도 처리 불필요)

3. 응답으로 받은 placeId를 fixedSlots: [{ placeId, dayNumber }]에 그대로 사용
   → 이후 흐름은 "사전 고정 슬롯 기반" 스펙과 100% 동일(변경 없음)

4. FastAPI 리트리버(PostgisTagRetriever/PgvectorRetriever)는 SQL에 is_curated = true 필터가
   있어 이 최소 정보 장소를 후보로 조회하지 않음 — 다른 유저의 AI 추천에 절대 안 섞임
```

**왜 `places`에 그대로 넣는가(별도 테이블을 안 만드는 이유)**: `route_slots.place_id`가 `places(id)` FK(`NOT NULL`, `ON DELETE RESTRICT`)라, 별도 테이블을 만들면 `route_slots` 자체나 이를 참조하는 기존 코드(재정렬/대안 교체/핀/예산/지도 등 place_id 기반 로직 전부)를 뜯어고쳐야 한다. `is_curated` 플래그 하나로 "물리적으로는 같은 테이블, 논리적으로는 후보 조회 쿼리에서 완전히 분리"를 달성하면 기존 파이프라인을 한 줄도 안 건드리고 재사용할 수 있다.

**왜 검색 브라우징 유출 걱정이 없는가**: `PlaceController`엔 `GET /{placeId}`(id로 직접 조회) 하나뿐이고 이름으로 검색/브라우징하는 엔드포인트 자체가 없다. `is_curated=false` 장소가 노출되는 유일한 경로는 그 장소를 직접 고정한 유저 본인의 루트, 또는 그 루트가 공개(is_public)됐을 때 이를 직접 열어본 사람뿐이다 — AI 추천이나 검색으로는 도달 불가능.

**동시성**: 두 유저가 거의 동시에 같은 신규 장소를 등록하면 이론상 row가 중복 생성될 수 있다. advisory lock 등으로 막지 않고 수용한다(이 스케일에서 과설계).

## 파일별 변경 사항

### DB (`backend/src/main/resources/db/migration/`)

- **신규 마이그레이션**: `places.is_curated BOOLEAN NOT NULL DEFAULT true` 추가(기존 row는 전부 `true`). `places.source` CHECK 제약에 `'manual'`, `'event'` 추가(`'tourapi', 'kakao', 'naver', 'hidden_gem'` → `'tourapi', 'kakao', 'naver', 'hidden_gem', 'manual', 'event'`).

### Spring (`backend/`)

- **`dto/ExternalPlaceRequest.java`** (신규): `record ExternalPlaceRequest(@NotBlank String name, String address, @NotNull Double lat, @NotNull Double lng, @NotBlank @Pattern(regexp = "manual|kakao|event") String source)` — `AccommodationCreateRequest`의 `source` 검증 패턴과 동일.
- **`dto/ExternalPlaceResponse.java`** (신규): `record ExternalPlaceResponse(UUID placeId)`.
- **`repository/PlaceRepository.java`**:
  - `findNearbyByName(double lng, double lat, int radiusM, String normalizedName)` 신규 — `ST_DWithin` + `LOWER(TRIM(name)) = :normalizedName` + `is_active = true`(비활성 처리된 옛 row는 재사용 후보에서 제외)로 기존 row 탐색(네이티브 쿼리, `Optional<UUID>` 또는 id만 담은 프로젝션 반환).
  - `insertMinimal(UUID id, String name, String address, double lng, double lat, String source)` 신규 — `accommodations.insertWithLocation()`과 동일한 `@Modifying` 네이티브 INSERT 패턴. `is_curated=false`는 컬럼 기본값이 아니라 INSERT 문에 명시(가독성).
- **`service/PlaceService.java`**: `resolveExternalPlace(ExternalPlaceRequest req)` 신규 — `findNearbyByName()` 먼저 조회, 없으면 `insertMinimal()`. 이름 정규화(`trim().toLowerCase()`)는 서비스 레이어에서 처리.
- **`controller/PlaceController.java`**: `POST /external` 추가(`@Valid ExternalPlaceRequest`, 인증 필요 — `@AuthenticationPrincipal`은 받되 사용 안 함, 다른 인증 필요 엔드포인트와 일관성 위해 유지).

### FastAPI (`ai/`)

- **`app/services/retrievers.py`**: `PostgisTagRetriever._fetch()`, `PgvectorRetriever._fetch()` 두 SQL에 `AND is_curated = true` 추가. `route_service.py`/`slot_alternatives.py`/`chat_service.py` 세 호출부 모두 이 클래스들을 그대로 재사용하므로 별도 수정 불필요.
- **`tests/test_retrievers.py`**: `db.fetch` 호출 시 넘어간 SQL 문자열에 `is_curated = true`가 포함되는지 확인하는 테스트 추가(기존 mock 패턴 재사용).

### Frontend (`frontend/`)

- **`app/dev/external-place-test.tsx`** (신규, 개발용) — 이름/주소/위도/경도/출처(`manual`/`kakao` 선택) 입력 폼 + 제출 버튼. `POST /v1/places/external` 호출 후 반환된 `placeId`를 화면에 표시. 위저드나 다른 화면에 연결하지 않는 독립 라우트. 나중에 콘서트 검색·"직접 추가" 정식 기능이 생기면 이 화면은 삭제하고 그 기능들이 API를 대신 호출한다.
- **`lib/api/places.ts`** (신규 또는 기존 파일에 추가) — `resolveExternalPlace(req)` 함수.
- **`types/index.ts`** — `ExternalPlaceRequest`/`ExternalPlaceResponse` 타입 추가.

## 에러 처리

| 상황 | 처리 |
|---|---|
| `name` 빈 문자열 | 422 (`@NotBlank`) |
| `source`가 `manual`/`kakao`/`event` 외 값 | 422 (`@Pattern`) |
| `lat`/`lng` 누락 | 422 (`@NotNull`) |
| 반경 50m 내 이름 일치 장소 없음 | 정상 흐름 — 신규 insert |
| 동시 요청으로 인한 드문 중복 insert | 수용(핵심 변경 절 참고) — 에러 아님 |

## 검증 방법

```bash
# 1. 백엔드 컴파일
cd backend && ./gradlew compileJava -q

# 2. FastAPI 리트리버 테스트
cd ai && .venv/bin/pytest tests/test_retrievers.py -v
# → is_curated 필터 관련 신규 테스트 포함 전체 통과

# 3. find-or-create 동작 확인 — 같은 이름/좌표로 두 번 호출
curl -X POST http://localhost:8080/v1/places/external \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"테스트 콘서트홀","address":"서울 어딘가","lat":37.5,"lng":127.0,"source":"manual"}'
# → { "placeId": "<uuid-A>" }
curl -X POST http://localhost:8080/v1/places/external \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"테스트 콘서트홀","address":"서울 어딘가","lat":37.5001,"lng":127.0001,"source":"manual"}'
# → 기대: 같은 <uuid-A> 반환(반경 50m 내 이름 일치 dedup)

# 4. 반환된 placeId로 fixedSlots 생성 확인 — "사전 고정 슬롯 기반" 스펙의 curl과 동일한 방식
curl -N -X POST http://localhost:8080/v1/routes/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"destination":"서울","startDate":"2026-08-01","endDate":"2026-08-03",
       "groupType":"solo","budgetLevel":"mid","tags":["카페"],
       "fixedSlots":[{"placeId":"<uuid-A>","dayNumber":1}]}'
# → 기대: day1에 <uuid-A>가 is_fixed=true로 정상 포함

# 5. DB에서 is_curated=false 확인
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -t -A -c \
  "SELECT is_curated FROM places WHERE id='<uuid-A>';"
# → f
```

## 다음 단계

이 기반이 승인되면:
1. **콘서트·이벤트 앵커** — Serper/KOPIS API 키 발급 후, 검색 결과를 `POST /v1/places/external`(`source: "event"`)로 그대로 연결. 고정 시각 제약(time-windowed 라우팅) 설계 별도 필요.
2. **"직접 장소 추가" 정식 기능** — 위저드 또는 상세보기에 지도 핀/검색 UI를 붙여 개발용 테스트 화면을 정식 기능으로 대체.
3. (데이터가 쌓인 뒤) `is_curated=false` 장소 중 인기 있는 것을 큐레이션 팀이 검토해 `true`로 승격시키는 워크플로우 — 지금은 범위 밖.

# 외부/수동 장소 처리 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `places` 테이블에 없는 장소(콘서트, 유저 직접 입력 등)를 find-or-create로 최소 정보만 저장해 `fixedSlots` 파이프라인에 그대로 편입시키되, AI 추천 후보 풀에는 절대 섞이지 않게 한다.

**Architecture:** `places.is_curated` 플래그로 "물리적으로는 같은 테이블, 논리적으로는 후보 조회에서 분리"를 구현한다. 신규 `POST /v1/places/external`가 반경 50m + 이름 일치로 기존 row를 재사용하거나 최소 정보로 새로 만들어 `placeId`를 반환하고, 이후 흐름은 기존 `fixedSlots` 계약을 그대로 탄다. FastAPI의 두 리트리버(PgvectorRetriever/PostgisTagRetriever)에 `is_curated = true` 필터를 추가해 route_service.py/slot_alternatives.py/chat_service.py 세 호출부 전체를 한 번에 보호한다.

**Tech Stack:** Spring Boot 3(Java 21) + PostgreSQL/PostGIS(Flyway), FastAPI(Python) + asyncpg, React Native + Expo(TypeScript)

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-09-external-place-handling-design.md`
- 반경 dedup 기준: 50미터, 이름 비교는 `trim() + 소문자` 정규화 후 완전 일치
- `places.source` 신규 허용값: `manual`, `event` (기존 `tourapi`, `kakao`, `naver`, `hidden_gem`에 추가)
- 신규 row는 항상 `is_curated = false`, 기존 row는 마이그레이션으로 전부 `true`
- **테스트 전략 차이**: 이 저장소의 `backend/`에는 `src/test` 디렉터리 자체가 없다(기존 컨벤션 — Spring 쪽은 유닛 테스트 없이 `./gradlew compileJava`로 컴파일만 확인하고, 실제 동작은 curl로 수동 검증). FastAPI(`ai/`)는 `pytest` 인프라가 있으므로 TDD로 진행한다. 이 차이는 오버사이트가 아니라 기존 저장소 컨벤션을 그대로 따른 것이다.
- 브랜치: `feat/123-external-place-handling` (이미 존재, 스펙 커밋 완료됨)
- 커밋 메시지는 `type: 이모지 [스택] 설명` 형식(예: `feat: ✨ [Spring] ...`) — `reference_github_naming` 컨벤션

---

### Task 1: DB 마이그레이션 — `places.is_curated` + `source` CHECK 확장

**Files:**
- Create: `backend/src/main/resources/db/migration/V13__add_places_is_curated.sql`

**Interfaces:**
- Produces: `places.is_curated` 컬럼(BOOLEAN NOT NULL DEFAULT true), `places_source_check` 제약이 `manual`/`event`도 허용

- [ ] **Step 1: 마이그레이션 파일 작성**

`V10__add_naver_source.sql`과 동일한 패턴(DROP CONSTRAINT → ADD CONSTRAINT)을 따른다.

```sql
-- ============================================================
-- V13: places.is_curated 플래그 신설 + source CHECK에 manual/event 추가
-- ============================================================
BEGIN;

ALTER TABLE places ADD COLUMN is_curated BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE places DROP CONSTRAINT places_source_check;
ALTER TABLE places ADD CONSTRAINT places_source_check
    CHECK (source IN ('tourapi', 'kakao', 'naver', 'hidden_gem', 'manual', 'event'));

COMMIT;
```

- [ ] **Step 2: 도커 spring 컨테이너 재빌드로 마이그레이션 적용 확인**

Run:
```bash
cd /Users/jiwoo/Desktop/cloumy
docker compose build spring
docker compose up -d spring
sleep 15
docker logs cloumy-spring-1 --tail 10
```
Expected: 로그에 `Current version of schema "public": 13`, `Started CloudmyApplication` 출력(마이그레이션 실패 시 Flyway 예외로 컨테이너가 죽음).

- [ ] **Step 3: 컬럼/제약 확인**

Run:
```bash
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c "\d places" | grep -i "is_curated\|places_source_check"
```
Expected: `is_curated` 컬럼과 `places_source_check` 제약이 목록에 나타남.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/resources/db/migration/V13__add_places_is_curated.sql
git commit -m "feat: ✨ [DB] places.is_curated 플래그 신설 + source CHECK에 manual/event 추가"
```

---

### Task 2: FastAPI 리트리버 — `is_curated` 필터 (TDD)

**Files:**
- Modify: `ai/app/services/retrievers.py`
- Modify: `ai/tests/test_retrievers.py`

**Interfaces:**
- Consumes: 없음(기존 클래스 시그니처 변경 없음 — SQL 본문만 수정)
- Produces: `PostgisTagRetriever`/`PgvectorRetriever` 둘 다 `is_curated = true`인 row만 후보로 반환(`route_service.py`, `slot_alternatives.py`, `chat_service.py` 세 호출부가 자동으로 이 필터의 혜택을 받음, 코드 변경 불필요)

- [ ] **Step 1: PostgisTagRetriever 실패하는 테스트 작성**

`ai/tests/test_retrievers.py`의 기존 `_row()`/`_db_mock()` 헬퍼를 그대로 재사용한다. 파일 끝에 추가:

```python
@pytest.mark.asyncio
async def test_postgis_tag_retriever_filters_uncurated_places_with_tags():
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[_row(False)])
    retriever = PostgisTagRetriever(db=db, city_coords=(127.0, 37.0), tags=["#맛집"])

    await retriever._aget_relevant_documents("")

    query = db.fetch.call_args[0][0]
    assert "is_curated = true" in query


@pytest.mark.asyncio
async def test_postgis_tag_retriever_filters_uncurated_places_without_tags():
    db = _db_mock()
    db.fetch = AsyncMock(return_value=[_row(False)])
    retriever = PostgisTagRetriever(db=db, city_coords=(127.0, 37.0), tags=[])

    await retriever._aget_relevant_documents("")

    query = db.fetch.call_args[0][0]
    assert "is_curated = true" in query
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/ai && .venv/bin/pytest tests/test_retrievers.py -k filters_uncurated -v`

Expected: FAIL — `assert "is_curated = true" in query` 에서 `AssertionError` (아직 SQL에 조건이 없음).

- [ ] **Step 3: `PostgisTagRetriever._fetch()`에 필터 추가**

`ai/app/services/retrievers.py`의 `PostgisTagRetriever._fetch()` 메서드를 아래로 교체(두 분기 모두 `AND is_active = true` 다음 줄에 `AND is_curated = true` 추가):

```python
    async def _fetch(self, radius_m: int, use_tags: bool) -> list[asyncpg.Record]:
        lng, lat = self.city_coords
        if use_tags:
            # places.category_tags는 항상 "#"로 시작(예: #관광, #야경)하는데, 호출부(프론트
            # 테마 선택 등)가 "#" 없이 넘기는 경우가 있어 그대로 비교하면 항상 0건이 된다.
            normalized_tags = [t if t.startswith("#") else f"#{t}" for t in self.tags]
            return await self.db.fetch(
                """
                SELECT
                    id, name, category_tags, address,
                    avg_duration_minutes, is_hidden_gem,
                    ST_X(location::geometry) AS lng,
                    ST_Y(location::geometry) AS lat
                FROM places
                WHERE ST_DWithin(
                    location::geography,
                    ST_MakePoint($1, $2)::geography,
                    $3
                )
                AND category_tags && $4::text[]
                AND is_active = true
                AND is_curated = true
                ORDER BY RANDOM()
                LIMIT 80
                """,
                lng, lat, radius_m, normalized_tags,
            )
        return await self.db.fetch(
            """
            SELECT
                id, name, category_tags, address,
                avg_duration_minutes, is_hidden_gem,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
            FROM places
            WHERE ST_DWithin(
                location::geography,
                ST_MakePoint($1, $2)::geography,
                $3
            )
            AND is_active = true
            AND is_curated = true
            ORDER BY RANDOM()
            LIMIT 80
            """,
            lng, lat, radius_m,
        )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/ai && .venv/bin/pytest tests/test_retrievers.py -k filters_uncurated -v`

Expected: PASS (2개 모두)

- [ ] **Step 5: PgvectorRetriever 실패하는 테스트 작성**

`PgvectorRetriever`는 `db.acquire()` → `conn.transaction()` → `conn.fetch()`로 이어지는 비동기 컨텍스트 매니저 체인을 쓰므로, 기존 `_db_mock()` 패턴만으로는 부족하다. `ai/tests/test_retrievers.py` 상단 import에 `PgvectorRetriever`를 추가하고, 파일 끝에 아래 테스트를 추가:

```python
class _AsyncCM:
    """asyncpg의 async with 체인(acquire/transaction)을 흉내내는 최소 컨텍스트 매니저."""

    def __init__(self, value):
        self._value = value

    async def __aenter__(self):
        return self._value

    async def __aexit__(self, *exc):
        return False


def _pgvector_db_mock(fetch_return: list[dict]) -> MagicMock:
    conn = MagicMock()
    conn.execute = AsyncMock()
    conn.fetch = AsyncMock(return_value=fetch_return)
    conn.transaction = MagicMock(return_value=_AsyncCM(None))

    db = MagicMock(spec=asyncpg.Pool)
    db.acquire = MagicMock(return_value=_AsyncCM(conn))
    return db, conn


def _openai_mock() -> MagicMock:
    openai_client = MagicMock()
    embedding_resp = MagicMock()
    embedding_resp.data = [MagicMock(embedding=[0.1] * 1536)]
    openai_client.embeddings.create = AsyncMock(return_value=embedding_resp)
    return openai_client


@pytest.mark.asyncio
async def test_pgvector_retriever_filters_uncurated_places():
    db, conn = _pgvector_db_mock([_row(False)])
    openai_client = _openai_mock()
    retriever = PgvectorRetriever(db=db, openai_client=openai_client, city_coords=(127.0, 37.0))

    await retriever._aget_relevant_documents("카페")

    query = conn.fetch.call_args[0][0]
    assert "is_curated = true" in query
```

이 테스트 파일의 `import` 줄(`from app.services.retrievers import PostgisTagRetriever`)을 아래로 교체:

```python
from app.services.retrievers import PostgisTagRetriever, PgvectorRetriever
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/ai && .venv/bin/pytest tests/test_retrievers.py -k pgvector_retriever_filters -v`

Expected: FAIL — `assert "is_curated = true" in query`

- [ ] **Step 7: `PgvectorRetriever._fetch()`에 필터 추가**

`ai/app/services/retrievers.py`의 `PgvectorRetriever._fetch()` 메서드를 아래로 교체:

```python
    async def _fetch(self, query_vec: np.ndarray, radius_m: int) -> list[asyncpg.Record]:
        lng, lat = self.city_coords
        async with self.db.acquire() as conn:
            async with conn.transaction():
                # ivfflat.probes: recall ↑ vs 속도 트레이드오프 (기본값 1 → 10으로 상향)
                await conn.execute("SET LOCAL ivfflat.probes = 10")
                return await conn.fetch(
                    """
                    SELECT
                        id, name, category_tags, address,
                        avg_duration_minutes, is_hidden_gem,
                        ST_X(location::geometry) AS lng,
                        ST_Y(location::geometry) AS lat
                    FROM places
                    WHERE ST_DWithin(
                        location::geography,
                        ST_MakePoint($2, $3)::geography,
                        $4
                    )
                    AND is_active = true
                    AND is_curated = true
                    AND embedding IS NOT NULL
                    ORDER BY embedding <=> $1::vector
                    LIMIT 80
                    """,
                    query_vec, lng, lat, radius_m,
                )
```

- [ ] **Step 8: 전체 테스트 통과 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/ai && .venv/bin/pytest tests/test_retrievers.py -v`

Expected: 기존 3개 + 신규 3개 = 6개 전부 PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/jiwoo/Desktop/cloumy
git add ai/app/services/retrievers.py ai/tests/test_retrievers.py
git commit -m "feat: ✨ [AI] 리트리버에 is_curated 필터 추가 — 미가공 장소 AI 추천 후보 제외"
```

---

### Task 3: Spring — `POST /v1/places/external` find-or-create 엔드포인트

**Files:**
- Create: `backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceRequest.java`
- Create: `backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceResponse.java`
- Modify: `backend/src/main/java/com/cloumy/trip/repository/PlaceRepository.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/PlaceService.java`
- Modify: `backend/src/main/java/com/cloumy/trip/controller/PlaceController.java`

**Interfaces:**
- Consumes: `PlaceRepository`(기존 `findPlaceDetailById` 패턴 — native query + `id::text` 캐스팅 컨벤션)
- Produces: `PlaceService.resolveExternalPlace(ExternalPlaceRequest req) -> UUID`, `POST /v1/places/external` → `ApiResponse<ExternalPlaceResponse>` (`{ "placeId": "<uuid>" }`)

- [ ] **Step 1: `ExternalPlaceRequest`/`ExternalPlaceResponse` DTO 작성**

`backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceRequest.java` (신규):

```java
package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record ExternalPlaceRequest(
        @NotBlank String name,
        String address,
        @NotNull Double lat,
        @NotNull Double lng,
        @NotBlank @Pattern(regexp = "manual|kakao|event") String source
) {}
```

`backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceResponse.java` (신규):

```java
package com.cloumy.trip.dto;

import java.util.UUID;

public record ExternalPlaceResponse(UUID placeId) {}
```

- [ ] **Step 2: `PlaceRepository`에 find-or-create 쿼리 2개 추가**

`backend/src/main/java/com/cloumy/trip/repository/PlaceRepository.java` 전체를 아래로 교체:

```java
package com.cloumy.trip.repository;

import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.entity.Place;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface PlaceRepository extends JpaRepository<Place, UUID> {

    // ST_Y = latitude, ST_X = longitude (WGS84 SRID 4326)
    @Query(value = """
            SELECT p.id::text                 AS id,
                   p.name                    AS name,
                   p.address                 AS address,
                   ST_Y(p.location::geometry) AS lat,
                   ST_X(p.location::geometry) AS lng,
                   p.avg_duration_minutes    AS avgDurationMinutes,
                   p.is_hidden_gem           AS isHiddenGem
            FROM places p
            WHERE p.id = :placeId
            """, nativeQuery = true)
    Optional<PlaceProjection> findPlaceDetailById(@Param("placeId") UUID placeId);

    // 외부/수동 장소 find-or-create — 반경 내 + 이름 일치(정규화된 문자열 비교)하는 기존 row 재사용.
    // is_curated 여부와 무관하게 찾는다 — 이미 배치로 들어간 큐레이션 장소와 같은 곳이면 그걸
    // 재사용하는 게 더 좋은 데이터다. is_active=false(비활성 처리된 옛 row)는 후보에서 제외.
    @Query(value = """
            SELECT id::text AS id
            FROM places
            WHERE ST_DWithin(
                location::geography,
                ST_MakePoint(:lng, :lat)::geography,
                :radiusM
            )
            AND LOWER(TRIM(name)) = :normalizedName
            AND is_active = true
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findNearbyPlaceIdByName(
            @Param("lng") double lng,
            @Param("lat") double lat,
            @Param("radiusM") int radiusM,
            @Param("normalizedName") String normalizedName);

    // location(GEOGRAPHY)은 JPA가 못 다뤄서 save()로 못 넣음 — accommodations.insertWithLocation()과
    // 동일한 네이티브 INSERT 패턴. is_curated=false는 컬럼 기본값에 기대지 않고 명시.
    @Modifying
    @Query(value = """
            INSERT INTO places (id, name, address, location, source, is_curated)
            VALUES (:id, :name, :address, ST_MakePoint(:lng, :lat)::geography, :source, false)
            """, nativeQuery = true)
    void insertMinimal(
            @Param("id") UUID id,
            @Param("name") String name,
            @Param("address") String address,
            @Param("lng") double lng,
            @Param("lat") double lat,
            @Param("source") String source);
}
```

- [ ] **Step 3: `PlaceService.resolveExternalPlace()` 추가**

`backend/src/main/java/com/cloumy/trip/service/PlaceService.java` 전체를 아래로 교체:

```java
package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.ExternalPlaceRequest;
import com.cloumy.trip.dto.PlaceDetailResponse;
import com.cloumy.trip.repository.PlaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class PlaceService {

    // 외부/수동 장소 find-or-create dedup 반경(미터) — 스펙에서 결정한 값
    private static final int EXTERNAL_PLACE_DEDUP_RADIUS_M = 50;

    private final PlaceRepository placeRepository;

    public PlaceDetailResponse getPlaceDetail(UUID placeId) {
        return placeRepository.findPlaceDetailById(placeId)
                .map(PlaceDetailResponse::from)
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
    }

    // find-or-create — 반경 50m + 이름 일치하는 기존 place가 있으면 재사용, 없으면 최소 정보로
    // 신규 생성(is_curated=false). 동시 요청으로 인한 드문 중복 생성은 이 스케일에서 수용한다.
    @Transactional
    public UUID resolveExternalPlace(ExternalPlaceRequest req) {
        String normalizedName = req.name().trim().toLowerCase();
        Optional<String> existingId = placeRepository.findNearbyPlaceIdByName(
                req.lng(), req.lat(), EXTERNAL_PLACE_DEDUP_RADIUS_M, normalizedName);
        if (existingId.isPresent()) {
            return UUID.fromString(existingId.get());
        }

        UUID newId = UUID.randomUUID();
        placeRepository.insertMinimal(newId, req.name(), req.address(), req.lng(), req.lat(), req.source());
        return newId;
    }
}
```

- [ ] **Step 4: `PlaceController`에 엔드포인트 추가**

`backend/src/main/java/com/cloumy/trip/controller/PlaceController.java` 전체를 아래로 교체:

```java
package com.cloumy.trip.controller;

import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.ExternalPlaceRequest;
import com.cloumy.trip.dto.ExternalPlaceResponse;
import com.cloumy.trip.dto.PlaceDetailResponse;
import com.cloumy.trip.service.PlaceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/v1/places")
@RequiredArgsConstructor
public class PlaceController {

    private final PlaceService placeService;

    @GetMapping("/{placeId}")
    public ApiResponse<PlaceDetailResponse> getPlaceDetail(@PathVariable UUID placeId) {
        return ApiResponse.ok(placeService.getPlaceDetail(placeId));
    }

    // 외부/수동 장소 find-or-create — 콘서트 검색 결과, 카카오 라이브 검색 결과, 유저 직접 입력이
    // 공통으로 호출. 인증은 SecurityConfig의 anyRequest().authenticated()로 강제되므로
    // 컨트롤러에서 별도로 principal을 받아 쓸 필요는 없다.
    @PostMapping("/external")
    public ApiResponse<ExternalPlaceResponse> resolveExternalPlace(
            @RequestBody @Valid ExternalPlaceRequest req
    ) {
        UUID placeId = placeService.resolveExternalPlace(req);
        return ApiResponse.ok(new ExternalPlaceResponse(placeId));
    }
}
```

- [ ] **Step 5: 컴파일 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/backend && ./gradlew compileJava -q`

Expected: 에러 없이 종료(출력 없음)

- [ ] **Step 6: Commit**

```bash
cd /Users/jiwoo/Desktop/cloumy
git add backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceRequest.java \
        backend/src/main/java/com/cloumy/trip/dto/ExternalPlaceResponse.java \
        backend/src/main/java/com/cloumy/trip/repository/PlaceRepository.java \
        backend/src/main/java/com/cloumy/trip/service/PlaceService.java \
        backend/src/main/java/com/cloumy/trip/controller/PlaceController.java
git commit -m "feat: ✨ [Spring] POST /v1/places/external find-or-create 엔드포인트"
```

---

### Task 4: Spring 실제 동작 curl 검증 (도커 재빌드)

이 저장소는 Spring 쪽에 유닛 테스트가 없으므로, 이 태스크가 Task 3의 실질적인 검증 단계다.

**Files:** 없음(검증 전용 태스크)

- [ ] **Step 1: 도커 spring 컨테이너 재빌드**

Run:
```bash
cd /Users/jiwoo/Desktop/cloumy
docker compose build spring
docker compose up -d spring
sleep 15
```
Expected: 빌드 성공, 컨테이너 정상 기동(`docker logs cloumy-spring-1 --tail 5`에 `Started CloudmyApplication` 출력)

- [ ] **Step 2: dev 토큰 발급**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/v1/dev/token -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")
echo "TOKEN: ${TOKEN:0:15}..."
```
Expected: 토큰 문자열 출력(빈 값이 아님)

- [ ] **Step 3: 신규 장소 생성 확인**

Run:
```bash
curl -s -X POST http://localhost:8080/v1/places/external \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"테스트 콘서트홀","address":"서울 어딘가","lat":37.5,"lng":127.0,"source":"manual"}'
```
Expected: `{"success":true,"data":{"placeId":"<uuid>"}}` — 이 uuid를 `PLACE_ID_A`로 기록해둔다.

- [ ] **Step 4: 같은 이름/근접 좌표로 재요청 — dedup 확인**

Run(위에서 받은 `PLACE_ID_A`를 실제 값으로 치환):
```bash
curl -s -X POST http://localhost:8080/v1/places/external \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"테스트 콘서트홀","address":"서울 어딘가","lat":37.5001,"lng":127.0001,"source":"manual"}'
```
Expected: **Step 3와 동일한 `placeId`** 반환(반경 50m 내 이름 일치로 재사용됨, 신규 row 안 생김)

- [ ] **Step 5: DB에서 `is_curated=false` 확인, row 1개만 있는지 확인**

Run:
```bash
docker exec cloumy-postgres-1 psql -U cloumy -d cloumy -c \
  "SELECT id, name, is_curated, source FROM places WHERE name='테스트 콘서트홀';"
```
Expected: **row 1개만** 존재, `is_curated = f`, `source = manual`

- [ ] **Step 6: 반환된 placeId로 fixedSlots 생성 확인**

Run(`PLACE_ID_A`를 Step 3에서 받은 실제 값으로 치환):
```bash
curl -N -s -X POST http://localhost:8080/v1/routes/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"destination":"서울","startDate":"2026-08-01","endDate":"2026-08-03",
       "groupType":"solo","budgetLevel":"mid","tags":["카페"],
       "fixedSlots":[{"placeId":"'"$PLACE_ID_A"'","dayNumber":1}]}' \
  --max-time 60 | grep "is_fixed"
```
Expected: `is_fixed:true` 라인에 `PLACE_ID_A`가 포함됨(사전 고정 슬롯 기반 파이프라인이 최소 정보 장소도 정상 처리)

- [ ] **Step 7: 잘못된 source 값 — 400 확인**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/v1/places/external \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"이상한소스","lat":37.5,"lng":127.0,"source":"invalid"}'
```
Expected: `400`

---

### Task 5: Frontend — API 클라이언트 + 타입

**Files:**
- Modify: `frontend/types/index.ts`
- Create: `frontend/lib/api/places.ts`

**Interfaces:**
- Consumes: `apiFetch`(from `frontend/lib/api/client.ts`) — 기존 컨벤션대로 `{ data: T }` 언랩
- Produces: `resolveExternalPlace(req: ExternalPlaceRequest) -> Promise<ExternalPlaceResponse>`

- [ ] **Step 1: 타입 추가**

`frontend/types/index.ts`에서 `export interface PlaceDetail` 블록 바로 아래에 추가:

```ts
// 외부/수동 장소 find-or-create — 콘서트 검색/카카오 라이브 검색/유저 직접 입력이 공통으로 사용
export interface ExternalPlaceRequest {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  source: 'manual' | 'kakao' | 'event';
}

export interface ExternalPlaceResponse {
  placeId: string;
}
```

- [ ] **Step 2: `frontend/lib/api/places.ts` 작성**

```ts
import { apiFetch } from './client';
import type { ExternalPlaceRequest, ExternalPlaceResponse } from '@/types';

export async function resolveExternalPlace(req: ExternalPlaceRequest): Promise<ExternalPlaceResponse> {
  const res = await apiFetch('/v1/places/external', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: ExternalPlaceResponse } = await res.json();
  return body.data;
}
```

- [ ] **Step 3: 타입체크 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/frontend && npx tsc --noEmit --ignoreDeprecations 6.0`

Expected: 에러 없음(출력 없음)

- [ ] **Step 4: Commit**

```bash
cd /Users/jiwoo/Desktop/cloumy
git add frontend/types/index.ts frontend/lib/api/places.ts
git commit -m "feat: ✨ [Frontend] 외부 장소 API 클라이언트 + 타입"
```

---

### Task 6: Frontend — 개발용 테스트 화면

**Files:**
- Create: `frontend/app/dev/external-place-test.tsx`

**Interfaces:**
- Consumes: `resolveExternalPlace()`(Task 5), `devLogin()`(from `frontend/lib/api/auth.ts`, `step-4.tsx`와 동일한 `__DEV__` 자동 로그인 패턴), `useAuthStore`(from `frontend/stores/useAuthStore.ts`)

- [ ] **Step 1: 화면 작성**

```tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { resolveExternalPlace } from '@/lib/api/places';
import { devLogin } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/useAuthStore';

type Source = 'manual' | 'kakao' | 'event';
const SOURCES: Source[] = ['manual', 'kakao', 'event'];

export default function ExternalPlaceTestScreen() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [source, setSource] = useState<Source>('manual');
  const [resultPlaceId, setResultPlaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { setTokens, setUser } = useAuthStore();

  const onSubmit = async () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!name.trim() || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      Alert.alert('입력 확인', '이름과 위도/경도(숫자)를 채워주세요');
      return;
    }

    setSubmitting(true);
    try {
      if (__DEV__) {
        const data = await devLogin();
        setTokens(data.accessToken, data.refreshToken);
        setUser(data.user);
      }
      const res = await resolveExternalPlace({
        name: name.trim(),
        address: address.trim() || null,
        lat: latNum,
        lng: lngNum,
        source,
      });
      setResultPlaceId(res.placeId);
    } catch (e) {
      Alert.alert('요청 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800">외부 장소 테스트 (dev)</Text>
      </View>

      <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="이름"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="주소 (선택)"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={lat}
          onChangeText={setLat}
          placeholder="위도 (예: 37.5)"
          keyboardType="numeric"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={lng}
          onChangeText={setLng}
          placeholder="경도 (예: 127.0)"
          keyboardType="numeric"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />

        <View className="flex-row gap-2 mb-6">
          {SOURCES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSource(s)}
              className={`px-4 py-2 rounded-full border-2 ${source === s ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`}
            >
              <Text className={`text-sm font-semibold ${source === s ? 'text-sky-600' : 'text-slate-500'}`}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={onSubmit}
          disabled={submitting}
          className="bg-sky-500 py-4 rounded-2xl items-center mb-6"
        >
          <Text className="text-white font-bold text-base">{submitting ? '요청 중...' : '전송'}</Text>
        </TouchableOpacity>

        {resultPlaceId && (
          <View className="border-2 border-sky-200 bg-sky-50 rounded-2xl px-4 py-4">
            <Text className="text-xs text-sky-500 font-bold mb-1">placeId</Text>
            <Text className="text-sm text-sky-700" selectable>{resultPlaceId}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: 타입체크 확인**

Run: `cd /Users/jiwoo/Desktop/cloumy/frontend && npx tsc --noEmit --ignoreDeprecations 6.0`

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
cd /Users/jiwoo/Desktop/cloumy
git add frontend/app/dev/external-place-test.tsx
git commit -m "feat: ✨ [Frontend] 외부 장소 개발용 테스트 화면"
```

---

## 최종 확인

- [ ] **전체 리트리버 테스트 재실행**: `cd /Users/jiwoo/Desktop/cloumy/ai && .venv/bin/pytest tests/ -v` — 전체 통과
- [ ] **전체 백엔드 컴파일**: `cd /Users/jiwoo/Desktop/cloumy/backend && ./gradlew compileJava -q` — 에러 없음
- [ ] **전체 프론트 타입체크**: `cd /Users/jiwoo/Desktop/cloumy/frontend && npx tsc --noEmit --ignoreDeprecations 6.0` — 에러 없음
- [ ] `git log --oneline -6`으로 태스크별 커밋 6개(DB/AI/Spring/curl검증은 커밋 없음/Frontend API/Frontend 화면) 확인

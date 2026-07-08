# 내 루트 목록 수동 드래그 정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "내 루트" 목록 화면에서 "수정하기" 모드에 들어가면 드래그 핸들로 루트 카드 순서를 바꿀 수 있고, "완료"를 눌러야 서버에 저장되며 "취소"하면 원래 순서로 복원된다.

**Architecture:** `routes` 테이블에 `display_order` 컬럼을 추가해 정렬 기준을 `created_at DESC`에서 `display_order ASC`로 바꾼다. 신규 `PATCH /v1/routes/reorder` 엔드포인트가 route ID 순서 배열을 받아 `display_order`를 일괄 재할당한다. 프론트는 `react-native-reanimated`/`react-native-gesture-handler`(이미 설치됨, 신규 라이브러리 없음)로 `Gesture.Pan()` 기반 드래그 컴포넌트를 직접 구현하고, 드래그 결과는 "완료" 시점에만 서버로 보낸다.

**Tech Stack:** Spring Boot 3(Java 21)/JPA/Flyway, React Native + Expo(TypeScript)/TanStack Query/react-native-reanimated v4/react-native-gesture-handler v2.

## Global Constraints

- **백엔드에 테스트 프레임워크(JUnit 등)가 설치돼 있지 않다**(`backend/src/test` 디렉토리 자체가 없음) — 기존 프로젝트 컨벤션대로 `curl`로 dev 서버에 직접 검증한다(신규 테스트 프레임워크 도입 금지, YAGNI).
- 프론트에도 테스트 러너가 없다 — `npx tsc --noEmit`과 수동 시뮬레이터/실기기 검증으로 확인한다.
- 신규 드래그 라이브러리 설치 금지 — 이미 있는 `react-native-reanimated`/`react-native-gesture-handler`로 직접 구현(`Gesture.Pan()` 방식, `useAnimatedGestureHandler`는 이 프로젝트에서 미지원 — `frontend/CLAUDE.md` 컨벤션).
- 드래그로 순서를 바꾸는 동안은 로컬 상태만 변경되고, "완료"를 눌러야 서버에 PATCH 요청이 나간다. "취소"하면 서버 재조회로 원래 순서를 복원한다(임시 저장 없음).
- `routes` 테이블의 `display_order` 컬럼에는 UNIQUE 제약을 걸지 않는다(상대 순서만 중요, 유일성 강제는 불필요 — `route_slots.order_index`가 겪었던 UNIQUE+Hibernate 배치 순서 문제를 피하기 위한 의도적 선택).
- 신규 루트 생성 시 목록 맨 앞(가장 최근 위치)에 오도록 배치한다.

---

### Task 1: `routes` 테이블에 `display_order` 컬럼 추가 + 백필

**Files:**
- Create: `backend/src/main/resources/db/migration/V12__add_routes_display_order.sql`
- Modify: `backend/src/main/java/com/cloumy/trip/entity/Route.java`

**Interfaces:**
- Consumes: 없음
- Produces: `Route` 엔티티에 `private Integer displayOrder` 필드(getter `getDisplayOrder()`), `Route.Builder`에 `displayOrder` 파라미터(선택), `Route`에 `updateDisplayOrder(int displayOrder)` mutator — 이후 태스크에서 `Route.getDisplayOrder()`/`Route.updateDisplayOrder(int)`로 사용

- [ ] **Step 1: 마이그레이션 SQL 작성**

`backend/src/main/resources/db/migration/V12__add_routes_display_order.sql`:
```sql
-- ============================================================
-- V12: routes.display_order 추가 — 사용자 수동 드래그 정렬 지원
-- 기존 라우트는 현재 created_at DESC 순서 그대로 백필해 정렬 기준을
-- 바꿔도 화면에 보이는 순서가 즉시 바뀌지 않도록 한다.
-- ============================================================
BEGIN;

ALTER TABLE routes ADD COLUMN display_order INTEGER;

UPDATE routes r
SET display_order = sub.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1 AS rn
    FROM routes
) sub
WHERE r.id = sub.id;

ALTER TABLE routes ALTER COLUMN display_order SET NOT NULL;

COMMIT;
```

- [ ] **Step 2: `Route.java`에 `displayOrder` 필드 추가**

`backend/src/main/java/com/cloumy/trip/entity/Route.java` 전체를 다음으로 교체:
```java
package com.cloumy.trip.entity;

import com.cloumy.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.util.UUID;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "routes")
public class Route extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String destination;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Column(nullable = false)
    private int nights;

    @Column(name = "group_type", nullable = false)
    private String groupType;

    @Column(name = "budget_level", nullable = false)
    private String budgetLevel;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]")
    private String[] tags = {};

    @Column(nullable = true)
    private String density;

    @Column(name = "is_public", nullable = false)
    private boolean isPublic = false;

    @Column(name = "save_count", nullable = false)
    private int saveCount = 0;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @Builder
    private Route(UUID userId, String title, String destination,
                  LocalDate startDate, LocalDate endDate, int nights,
                  String groupType, String budgetLevel, String[] tags, String density,
                  int displayOrder) {
        this.userId = userId;
        this.title = title;
        this.destination = destination;
        this.startDate = startDate;
        this.endDate = endDate;
        this.nights = nights;
        this.groupType = groupType;
        this.budgetLevel = budgetLevel;
        this.tags = tags != null ? tags : new String[]{};
        this.density = density;
        this.isPublic = false;
        this.saveCount = 0;
        this.displayOrder = displayOrder;
    }

    public void updateDisplayOrder(int displayOrder) {
        this.displayOrder = displayOrder;
    }
}
```

- [ ] **Step 3: 마이그레이션 적용 확인**

```bash
docker compose restart spring
sleep 5
docker exec cloumy-postgres-1 psql -U postgres -d cloumy -c "\d routes" | grep display_order
```
Expected: `display_order | integer | not null` 형태 출력.

```bash
docker exec cloumy-postgres-1 psql -U postgres -d cloumy -c "SELECT id, user_id, created_at, display_order FROM routes ORDER BY user_id, display_order LIMIT 10;"
```
Expected: 각 `user_id` 그룹 내에서 `display_order`가 0부터 오름차순, `created_at`은 그 반대로(최신이 0) 정렬된 걸 확인.

- [ ] **Step 4: 커밋**

```bash
git add backend/src/main/resources/db/migration/V12__add_routes_display_order.sql backend/src/main/java/com/cloumy/trip/entity/Route.java
git commit -m "feat: ✨ [Spring] routes.display_order 컬럼 추가 + 기존 데이터 백필"
```

---

### Task 2: 목록 조회를 `display_order` 기준 정렬로 전환 + 신규 루트는 맨 앞에 배치

**Files:**
- Modify: `backend/src/main/java/com/cloumy/trip/repository/RouteRepository.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/RouteService.java`
- Modify: `backend/src/main/java/com/cloumy/trip/controller/RouteController.java:54-58`

**Interfaces:**
- Consumes: Task 1의 `Route.getDisplayOrder()`, `Route.Builder.displayOrder(int)`
- Produces: `RouteRepository.findByUserIdOrderByDisplayOrderAsc(UUID, Pageable)`, `RouteRepository.findMinDisplayOrder(UUID)` — Task 3에서 재사용

- [ ] **Step 1: `RouteRepository.java` 수정**

`findByUserIdOrderByCreatedAtDesc`를 `findByUserIdOrderByDisplayOrderAsc`로 교체하고, 신규 루트 배치용 최소값 조회 쿼리를 추가:

```java
package com.cloumy.trip.repository;

import com.cloumy.trip.entity.Route;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RouteRepository extends JpaRepository<Route, UUID> {

    Page<Route> findByUserIdOrderByDisplayOrderAsc(UUID userId, Pageable pageable);

    // 리오더 응답에서 페이지네이션 없이 전체 순서를 다시 내려줄 때 사용
    List<Route> findByUserIdOrderByDisplayOrderAsc(UUID userId);

    // 신규 루트를 목록 맨 앞에 배치하기 위한 현재 최소 display_order 조회
    // (해당 유저의 루트가 하나도 없으면 0을 반환 — 첫 루트는 display_order=0-1=-1로 시작해도 무방)
    @Query("SELECT COALESCE(MIN(r.displayOrder), 0) FROM Route r WHERE r.userId = :userId")
    Integer findMinDisplayOrder(@Param("userId") UUID userId);

    // 폴백 — FastAPI 장애 시 유사 루트 추천 (destination + 박수±1 + 태그 겹침)
    // tags가 text[]라 JPQL로 && 연산자를 못 써서 native query 필요.
    // String[]를 JDBC 배열로 직접 바인딩하면 Hibernate native query에서 타입 매핑이 불안정해서,
    // 콤마 join한 문자열을 string_to_array()로 캐스팅하는 방식을 쓴다.
    // tagsCsv가 빈 문자열이면 tags 조건 자체를 스킵(태그 없는 요청은 destination+nights만으로 매칭).
    @Query(value = """
            SELECT * FROM routes
            WHERE destination = :destination
              AND nights BETWEEN :nights - 1 AND :nights + 1
              AND (:tagsCsv = '' OR tags && string_to_array(:tagsCsv, ','))
              AND is_public = true
              AND created_at > NOW() - INTERVAL '30 days'
            ORDER BY save_count DESC
            LIMIT 3
            """, nativeQuery = true)
    List<Route> findSimilarRoutes(
            @Param("destination") String destination,
            @Param("nights") int nights,
            @Param("tagsCsv") String tagsCsv);
}
```

- [ ] **Step 2: `RouteService.java` 수정**

`getMyRoutes`가 새 정렬 메서드를 쓰도록, `createRoute`가 신규 루트를 맨 앞에 배치하도록 수정:

```java
    public Page<RouteListResponse> getMyRoutes(UUID userId, Pageable pageable) {
        return routeRepository.findByUserIdOrderByDisplayOrderAsc(userId, pageable)
                .map(r -> new RouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(),
                        r.getStartDate(), r.getEndDate(), r.getNights(),
                        r.getCreatedAt()
                ));
    }
```
(`getRoute`, `deleteRoute`는 변경 없음.)

`createRoute` 안의 `Route.builder()` 호출에 `displayOrder` 추가:
```java
    @Transactional
    public Route createRoute(RouteGenRequest req, UUID userId) {
        passValidationService.validate(userId);

        String title = req.destination() + " " + req.nights() + "박 여행";
        String[] tags = req.tags() != null ? req.tags().toArray(new String[0]) : new String[]{};
        int displayOrder = routeRepository.findMinDisplayOrder(userId) - 1;

        Route route = Route.builder()
                .userId(userId)
                .title(title)
                .destination(req.destination())
                .startDate(req.startDate())
                .endDate(req.endDate())
                .nights(req.nights())
                .groupType(req.groupType().toLowerCase())
                .budgetLevel(req.budgetLevel().toLowerCase())
                .tags(tags)
                .density(req.density() != null ? req.density().toLowerCase() : "normal")
                .displayOrder(displayOrder)
                .build();

        Route saved = routeRepository.save(route);
```
(이후 로직은 변경 없음 — `totalBudget`/숙소 저장 부분 그대로 유지.)

- [ ] **Step 3: `RouteController.java` Pageable 기본 정렬 수정**

```java
    @GetMapping("/routes")
    public ApiResponse<Page<RouteListResponse>> getMyRoutes(
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 10, sort = "displayOrder", direction = Sort.Direction.ASC) Pageable pageable
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.getMyRoutes(userId, pageable));
    }
```
(다른 엔드포인트는 변경 없음.)

- [ ] **Step 4: 컴파일 + 재시작 확인**

```bash
cd backend && ./gradlew compileJava
```
Expected: `BUILD SUCCESSFUL`.

```bash
docker compose build spring && docker compose up -d spring
sleep 5
curl -s -H "Authorization: Bearer $(cat /tmp/dev_token.txt 2>/dev/null || echo dev-token)" http://localhost:8080/v1/routes | jq '.data.content[] | {id, title}'
```
Expected: 기존과 동일한 순서(백필값 기준)로 루트 목록이 반환됨 — 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/cloumy/trip/repository/RouteRepository.java backend/src/main/java/com/cloumy/trip/service/RouteService.java backend/src/main/java/com/cloumy/trip/controller/RouteController.java
git commit -m "feat: ✨ [Spring] 루트 목록 정렬 기준을 display_order로 전환, 신규 루트는 맨 앞 배치"
```

---

### Task 3: `PATCH /v1/routes/reorder` 엔드포인트

**Files:**
- Create: `backend/src/main/java/com/cloumy/trip/dto/ReorderRoutesRequest.java`
- Modify: `backend/src/main/java/com/cloumy/trip/service/RouteService.java`
- Modify: `backend/src/main/java/com/cloumy/trip/controller/RouteController.java`

**Interfaces:**
- Consumes: Task 2의 `RouteRepository.findByUserIdOrderByDisplayOrderAsc(UUID)`(non-paged), Task 1의 `Route.updateDisplayOrder(int)`
- Produces: `RouteService.reorderRoutes(UUID userId, List<UUID> routeIds): List<RouteListResponse>` — 프론트에서 호출할 최종 API 계약(`PATCH /v1/routes/reorder`, body `{"routeIds": ["uuid1","uuid2",...]}`, 응답 `List<RouteListResponse>`)

- [ ] **Step 1: 요청 DTO 작성**

`backend/src/main/java/com/cloumy/trip/dto/ReorderRoutesRequest.java`:
```java
package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

public record ReorderRoutesRequest(
        @NotEmpty List<UUID> routeIds
) {}
```

- [ ] **Step 2: `RouteService.reorderRoutes` 구현**

`RouteService.java`에 추가(기존 import에 `List`, `ReorderRoutesRequest`는 컨트롤러에서만 쓰므로 서비스는 `List<UUID>`만 받음):

```java
    @Transactional
    public List<RouteListResponse> reorderRoutes(UUID userId, List<UUID> routeIds) {
        List<Route> routes = routeRepository.findAllById(routeIds);

        if (routes.size() != routeIds.size()) {
            throw new BusinessException(ErrorCode.ROUTE_NOT_FOUND);
        }
        for (Route route : routes) {
            if (!route.getUserId().equals(userId)) {
                throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
            }
        }

        for (int i = 0; i < routeIds.size(); i++) {
            UUID targetId = routeIds.get(i);
            int newOrder = i;
            routes.stream()
                    .filter(r -> r.getId().equals(targetId))
                    .findFirst()
                    .ifPresent(r -> r.updateDisplayOrder(newOrder));
        }

        return routeRepository.findByUserIdOrderByDisplayOrderAsc(userId)
                .stream()
                .map(r -> new RouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(),
                        r.getStartDate(), r.getEndDate(), r.getNights(),
                        r.getCreatedAt()
                ))
                .toList();
    }
```

`RouteService.java` 상단 import 블록:
```java
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
```
를 아래로 교체(`java.util.List` 추가):
```java
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
```

- [ ] **Step 3: 컨트롤러 엔드포인트 추가**

`RouteController.java`의 기존 import 블록:
```java
import com.cloumy.trip.dto.DaySummaryResponse;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
```
를 아래로 교체(`ReorderRoutesRequest` 추가):
```java
import com.cloumy.trip.dto.DaySummaryResponse;
import com.cloumy.trip.dto.ReorderRoutesRequest;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
```

기존 import 블록:
```java
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
```
를 아래로 교체(`PatchMapping` 추가):
```java
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
```

`deleteRoute` 메서드 뒤에 추가:

```java
    @PatchMapping("/routes/reorder")
    public ApiResponse<List<RouteListResponse>> reorderRoutes(
            @RequestBody @Valid ReorderRoutesRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.reorderRoutes(userId, req.routeIds()));
    }
```

- [ ] **Step 4: 컴파일 + curl로 동작 검증**

```bash
cd backend && ./gradlew compileJava
```
Expected: `BUILD SUCCESSFUL`.

```bash
docker compose build spring && docker compose up -d spring
sleep 5

# 1. 현재 순서 확인
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/v1/routes | jq '.data.content[].id'

# 2. 순서를 뒤집어서 reorder 요청 (위에서 나온 id들을 역순으로 배열에 넣기)
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"routeIds": ["<id2>", "<id1>"]}' \
  http://localhost:8080/v1/routes/reorder | jq '.data[].id'
# 기대 결과: 응답 순서가 요청한 routeIds 순서와 일치

# 3. 다시 목록 조회해서 반영 확인
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/v1/routes | jq '.data.content[].id'
# 기대 결과: 2번 응답과 동일한 순서

# 4. 다른 유저 소유 route ID를 섞어 요청 → 403 확인
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"routeIds": ["<다른-유저-route-id>"]}' \
  http://localhost:8080/v1/routes/reorder -w "\n%{http_code}\n"
# 기대 결과: 403
```

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/cloumy/trip/dto/ReorderRoutesRequest.java backend/src/main/java/com/cloumy/trip/service/RouteService.java backend/src/main/java/com/cloumy/trip/controller/RouteController.java
git commit -m "feat: ✨ [Spring] PATCH /v1/routes/reorder 엔드포인트 추가"
```

---

### Task 4: 프론트 `reorderRoutes` API 함수

**Files:**
- Modify: `frontend/lib/api/routes.ts`

**Interfaces:**
- Consumes: Task 3의 `PATCH /v1/routes/reorder` (body `{routeIds: string[]}`, 응답 `{data: RouteListItem[]}`)
- Produces: `export async function reorderRoutes(routeIds: string[]): Promise<RouteListItem[]>` — Task 6에서 사용

- [ ] **Step 1: 함수 추가**

`frontend/lib/api/routes.ts`의 `deleteRoute` 함수 뒤에 추가:
```ts
export async function reorderRoutes(routeIds: string[]): Promise<RouteListItem[]> {
  const res = await apiFetch('/v1/routes/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeIds }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteListItem[] } = await res.json();
  return body.data;
}
```

- [ ] **Step 2: 타입체크**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "routes.ts"
```
Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add frontend/lib/api/routes.ts
git commit -m "feat: ✨ [Frontend] reorderRoutes API 함수 추가"
```

---

### Task 5: 드래그 정렬 컴포넌트(`ReorderableRouteList`) 신규 작성

**Files:**
- Create: `frontend/components/route/ReorderableRouteList.tsx`

**Interfaces:**
- Consumes: `RouteListItem`(`@/types`), `RouteCard`와 동일한 표시 정보(다만 `RouteCard` 컴포넌트 자체는 `frontend/app/routes/index.tsx`에 로컬로 정의돼 있어 export 안 됨 — 이 컴포넌트 안에 카드 표시를 위한 최소 UI를 자체적으로 둔다, 아래 Step 1 참고)
- Produces: `export function ReorderableRouteList({ routes, onOrderChange }: { routes: RouteListItem[]; onOrderChange: (newOrder: RouteListItem[]) => void }): JSX.Element` — Task 6에서 `frontend/app/routes/index.tsx`가 이 컴포넌트를 import해서 사용

- [ ] **Step 1: 컴포넌트 작성**

`frontend/components/route/ReorderableRouteList.tsx` (신규 파일):
```tsx
import { useState } from 'react';
import { View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GripVertical, MapPin, Calendar } from 'lucide-react-native';
import type { RouteListItem } from '@/types';

// RouteCard(routes/index.tsx 로컬 컴포넌트) 한 장의 대략적인 렌더 높이(margin 포함) —
// 드래그 중 몇 칸을 이동했는지 계산하는 기준값. 실제 카드 높이가 이 값과 정확히 같을
// 필요는 없다(내용에 따라 약간 다를 수 있어도 반올림 계산이라 오차에 관대함).
const ROW_HEIGHT = 112;

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getMonth() + 1}.${s.getDate()} - ${e.getMonth() + 1}.${e.getDate()}`;
}

function DraggableRow({
  route,
  index,
  count,
  onMove,
}: {
  route: RouteListItem;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const rawOffset = Math.round(translateY.value / ROW_HEIGHT);
      const targetIndex = Math.min(Math.max(index + rawOffset, 0), count - 1);
      translateY.value = withTiming(0, { duration: 150 });
      isDragging.value = false;
      if (targetIndex !== index) {
        runOnJS(onMove)(index, targetIndex);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isDragging.value ? 10 : 0,
    shadowOpacity: isDragging.value ? 0.15 : 0,
    shadowRadius: 8,
    elevation: isDragging.value ? 4 : 0,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <View className="flex-row items-center mx-6 mb-4">
        <GestureDetector gesture={panGesture}>
          <View className="pr-3 py-2" hitSlop={8}>
            <GripVertical size={20} color="#94a3b8" />
          </View>
        </GestureDetector>
        <View className="flex-1 bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
          <View className="p-5">
            <Text className="text-lg font-bold text-slate-800 mb-3" numberOfLines={1}>
              {route.title}
            </Text>
            <View className="flex-row items-center gap-4">
              <View className="flex-row items-center gap-1.5">
                <MapPin size={13} color="#64748b" />
                <Text className="text-slate-500 text-sm">{route.destination}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Calendar size={13} color="#64748b" />
                <Text className="text-slate-500 text-sm">
                  {formatDateRange(route.startDate, route.endDate)} ({route.nights}박)
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export function ReorderableRouteList({
  routes,
  onOrderChange,
}: {
  routes: RouteListItem[];
  onOrderChange: (newOrder: RouteListItem[]) => void;
}) {
  const handleMove = (from: number, to: number) => {
    const next = [...routes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onOrderChange(next);
  };

  return (
    <View style={{ paddingTop: 16, paddingBottom: 32 }}>
      {routes.map((route, index) => (
        <DraggableRow
          key={route.id}
          route={route}
          index={index}
          count={routes.length}
          onMove={handleMove}
        />
      ))}
    </View>
  );
}
```

`GripVertical`은 `lucide-react-native`에 이미 포함된 아이콘 export(`node_modules/lucide-react-native/dist/cjs/icons/grip-vertical.js` 확인 완료) — 다른 화면에서 안 쓰였을 뿐 별도 확인/설치 불필요.

- [ ] **Step 2: 타입체크**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "ReorderableRouteList"
```
Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/route/ReorderableRouteList.tsx
git commit -m "feat: ✨ [Frontend] 드래그 정렬 컴포넌트(ReorderableRouteList) 추가"
```

---

### Task 6: `routes/index.tsx`에 편집모드 + 드래그 정렬 연결

**Files:**
- Modify: `frontend/app/routes/index.tsx`

**Interfaces:**
- Consumes: Task 4의 `reorderRoutes(routeIds: string[]): Promise<RouteListItem[]>`, Task 5의 `ReorderableRouteList`
- Produces: 없음(최종 화면 통합)

- [ ] **Step 1: import 및 state 추가**

`frontend/app/routes/index.tsx` 상단 import에 추가:
```tsx
import { useRef, useState } from 'react';
```
(기존 `import { useRef } from 'react';`를 위처럼 교체.)

```tsx
import { getMyRoutes, deleteRoute, reorderRoutes } from '@/lib/api/routes';
```
(기존 `import { getMyRoutes, deleteRoute } from '@/lib/api/routes';`를 위처럼 교체.)

```tsx
import { ReorderableRouteList } from '@/components/route/ReorderableRouteList';
```
(신규 import 한 줄 추가.)

- [ ] **Step 2: `RoutesScreen` 컴포넌트에 편집모드 state 추가**

`export default function RoutesScreen() {` 함수 본문 시작 부분(`const routes = data?.content ?? [];` 다음 줄)에 추가:
```tsx
  const [isEditMode, setIsEditMode] = useState(false);
  const [orderedRoutes, setOrderedRoutes] = useState<RouteListItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
```

- [ ] **Step 3: 편집모드 진입/완료/취소 핸들러 추가**

`handleDelete` 함수 뒤에 추가:
```tsx
  const handleEnterEditMode = () => {
    setOrderedRoutes(routes);
    setIsEditMode(true);
  };

  const handleReorderDone = async () => {
    setIsSaving(true);
    try {
      const updated = await reorderRoutes(orderedRoutes.map((r) => r.id));
      queryClient.setQueryData<SpringPage<RouteListItem>>(['routes', 'all'], (old) =>
        old ? { ...old, content: updated } : old,
      );
    } catch {
      queryClient.invalidateQueries({ queryKey: ['routes', 'all'] });
    } finally {
      setIsSaving(false);
      setIsEditMode(false);
    }
  };

  const handleReorderCancel = () => {
    queryClient.invalidateQueries({ queryKey: ['routes', 'all'] });
    setIsEditMode(false);
  };
```

- [ ] **Step 4: 헤더에 "수정하기" 버튼 추가**

기존 헤더 블록:
```tsx
      <View className="flex-row items-center px-6 py-4 bg-white border-b border-slate-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800 flex-1">{t('routesList.headerTitle')}</Text>
        <TouchableOpacity
          onPress={() => router.push('/route/create/step-1' as never)}
          className="bg-sky-500 px-4 py-2 rounded-xl"
          activeOpacity={0.85}
        >
          <Text className="text-white text-sm font-bold">{t('routesList.newRouteButton')}</Text>
        </TouchableOpacity>
      </View>
```
을 아래로 교체(편집모드일 땐 "+ 새 루트" 버튼 대신 "완료"/"취소", 평소엔 "+ 새 루트" 옆에 "수정하기" 추가):
```tsx
      <View className="flex-row items-center px-6 py-4 bg-white border-b border-slate-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800 flex-1">{t('routesList.headerTitle')}</Text>
        {isEditMode ? (
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={handleReorderCancel}
              disabled={isSaving}
              style={{ borderWidth: 2, borderColor: '#94a3b8', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12 }}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 13 }}>{t('routeResult.cancelButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReorderDone}
              disabled={isSaving}
              style={{ backgroundColor: '#0ea5e9', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12 }}
              activeOpacity={0.85}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('routeResult.doneEditButton')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={handleEnterEditMode}
              style={{ backgroundColor: '#0ea5e9', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12 }}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('routeResult.editButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/route/create/step-1' as never)}
              className="bg-sky-500 px-4 py-2 rounded-xl"
              activeOpacity={0.85}
            >
              <Text className="text-white text-sm font-bold">{t('routesList.newRouteButton')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
```

- [ ] **Step 5: 편집모드일 때 `ReorderableRouteList`로 전환**

기존 리스트 렌더링 블록:
```tsx
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} t={t} />
      ) : routes.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SwipeableRouteCard route={item} onDelete={handleDelete} t={t} />
          )}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
```
을 아래로 교체(편집모드면 스와이프 삭제 대신 드래그 정렬 리스트):
```tsx
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} t={t} />
      ) : routes.length === 0 ? (
        <EmptyState t={t} />
      ) : isEditMode ? (
        <ReorderableRouteList routes={orderedRoutes} onOrderChange={setOrderedRoutes} />
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SwipeableRouteCard route={item} onDelete={handleDelete} t={t} />
          )}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
```

- [ ] **Step 6: 타입체크**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "routes/index.tsx"
```
Expected: 출력 없음.

- [ ] **Step 7: 커밋**

```bash
git add "frontend/app/routes/index.tsx"
git commit -m "feat: ✨ [Frontend] 내 루트 목록 편집모드 + 드래그 정렬 연결"
```

- [ ] **Step 8: 수동 검증 (시뮬레이터/실기기)**

1. "내 루트" 목록에서 "수정하기" 탭 → 각 행 왼쪽에 드래그 핸들(☰ 아이콘)이 보이는지 확인
2. 드래그 핸들을 눌러 위/아래로 끌면 그 행이 이동하고, 다른 행들과 순서가 바뀌는지 확인
3. "완료" 탭 → 로딩 표시 후 화면을 나갔다 다시 들어와도 바뀐 순서가 유지되는지 확인
4. 순서를 바꾼 뒤 "취소" 탭 → 원래 순서로 돌아오는지 확인
5. 새 루트를 생성한 뒤 목록 맨 위에 오는지 확인

---

## Self-Review

**Spec coverage:**
- "display_order 컬럼 추가 + 백필" → Task 1
- "정렬 기준 전환 + 신규 루트 맨 앞 배치" → Task 2
- "PATCH /v1/routes/reorder 엔드포인트" → Task 3
- "완료 시에만 서버 저장, 취소 시 원복" → Task 6의 `handleReorderDone`/`handleReorderCancel`
- "드래그 UI, 신규 라이브러리 없이 Gesture.Pan()" → Task 5
- "수정하기/완료/취소 버튼(기존 route/[routeId] 패턴 재사용)" → Task 6 Step 4, `routeResult.editButton`/`doneEditButton`/`cancelButton` i18n 키 재사용(신규 키 추가 없음)

**Placeholder scan:** 없음 — 모든 스텝에 완전한 코드/명령어 포함.

**Type consistency:** `reorderRoutes(routeIds: string[]): Promise<RouteListItem[]>`(Task 4)이 Task 6의 `reorderRoutes(orderedRoutes.map((r) => r.id))` 호출과 일치. `ReorderableRouteList({ routes, onOrderChange }: { routes: RouteListItem[]; onOrderChange: (newOrder: RouteListItem[]) => void })`(Task 5)가 Task 6의 `<ReorderableRouteList routes={orderedRoutes} onOrderChange={setOrderedRoutes} />` 호출과 일치. 백엔드 `RouteService.reorderRoutes(UUID, List<UUID>)`(Task 3)이 컨트롤러의 `routeService.reorderRoutes(userId, req.routeIds())` 호출과 일치.

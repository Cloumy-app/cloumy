package com.cloumy.trip.repository;

import com.cloumy.trip.dto.SlotProjection;
import com.cloumy.trip.entity.RouteSlot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RouteSlotRepository extends JpaRepository<RouteSlot, UUID> {

    boolean existsByRouteIdAndDayNumberAndOrderIndex(UUID routeId, int dayNumber, int orderIndex);

    Optional<RouteSlot> findByRouteIdAndDayNumberAndOrderIndex(UUID routeId, int dayNumber, int orderIndex);

    // 사전 고정 슬롯 기반 — FastAPI가 스트리밍으로 흘려보낸 최종 순서/이동정보를 적용할
    // 대상을 찾을 때 pinned=true 조건까지 걸어, 유저가 상세보기에서 직접 핀 지정한
    // 일반 슬롯과 뒤섞이지 않게 한다.
    Optional<RouteSlot> findByRouteIdAndDayNumberAndPlaceIdAndPinnedTrue(
            UUID routeId, int dayNumber, UUID placeId);

    // start_time 캐스케이드 재계산용 — 해당 day 전체를 order_index 순으로 조회
    List<RouteSlot> findByRouteIdAndDayNumberOrderByOrderIndex(UUID routeId, int dayNumber);

    // 루트/커뮤니티 탭 신설 — 전체 가져오기(clone) 시 원본 슬롯을 엔티티 그대로 복사하기 위한 조회.
    // findSlotsByRouteId(SlotProjection)는 장소 조인 결과라 place_id/transport_* 원본 필드 복사에 부적합
    List<RouteSlot> findByRouteIdOrderByDayNumberAscOrderIndexAsc(UUID routeId);

    // 슬롯 삽입 시 뒤 슬롯들의 order_index를 미는 대상 조회 — 큰 값부터 내림차순으로 반환해야
    // 순서대로 +1 했을 때 (route_id, day_number, order_index) UNIQUE 제약과 중간에 충돌하지 않는다.
    List<RouteSlot> findByRouteIdAndDayNumberAndOrderIndexGreaterThanOrderByOrderIndexDesc(
            UUID routeId, int dayNumber, int orderIndex);

    // 예산 관리 — 계획지출(자동 생성 슬롯)은 캐시하지 않고 매번 이 합계를 그대로 사용
    @Query("SELECT COALESCE(SUM(s.estimatedCost), 0) FROM RouteSlot s WHERE s.routeId = :routeId")
    int sumEstimatedCostByRouteId(@Param("routeId") UUID routeId);

    // places 테이블과 JOIN해서 lat/lng 포함한 슬롯 목록 반환
    // ST_Y(geometry) = latitude, ST_X(geometry) = longitude (WGS84)
    @Query(value = """
            SELECT rs.id::text                      AS id,
                   rs.day_number                    AS dayNumber,
                   rs.order_index                   AS orderIndex,
                   rs.is_pinned                     AS pinned,
                   rs.start_time::text              AS startTime,
                   rs.duration_minutes              AS durationMinutes,
                   rs.estimated_cost                AS estimatedCost,
                   rs.transport_to_next             AS transportToNext,
                   rs.transport_minutes             AS transportMinutes,
                   rs.transit_summary               AS transitSummary,
                   rs.transit_detail                AS transitDetail,
                   rs.tips                          AS tips,
                   p.id::text                       AS placeId,
                   p.name                           AS placeName,
                   p.address                        AS address,
                   ST_Y(p.location::geometry)       AS lat,
                   ST_X(p.location::geometry)       AS lng,
                   p.avg_duration_minutes           AS avgDurationMinutes
            FROM route_slots rs
            JOIN places p ON rs.place_id = p.id
            WHERE rs.route_id = :routeId
            ORDER BY rs.day_number, rs.order_index
            """, nativeQuery = true)
    List<SlotProjection> findSlotsByRouteId(@Param("routeId") UUID routeId);
}

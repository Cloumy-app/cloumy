package com.cloumy.trip.repository;

import com.cloumy.trip.dto.SlotProjection;
import com.cloumy.trip.entity.RouteSlot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RouteSlotRepository extends JpaRepository<RouteSlot, UUID> {

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
                   rs.tips                          AS tips,
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

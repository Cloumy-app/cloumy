package com.cloumy.trip.repository;

import com.cloumy.trip.entity.RouteDaySummary;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RouteDaySummaryRepository extends JpaRepository<RouteDaySummary, UUID> {

    List<RouteDaySummary> findByRouteIdOrderByDayNumber(UUID routeId);

    // day_summary는 스트림 중 재전송될 수 있어 스킵이 아닌 최신값 upsert로 멱등 처리
    @Modifying
    @Query(value = """
            INSERT INTO route_day_summaries(route_id, day_number, summary)
            VALUES (:routeId, :dayNumber, :summary)
            ON CONFLICT (route_id, day_number) DO UPDATE SET summary = EXCLUDED.summary
            """, nativeQuery = true)
    void upsert(@Param("routeId") UUID routeId, @Param("dayNumber") int dayNumber, @Param("summary") String summary);
}

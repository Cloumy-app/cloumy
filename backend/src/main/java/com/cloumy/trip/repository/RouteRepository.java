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

    Page<Route> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

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

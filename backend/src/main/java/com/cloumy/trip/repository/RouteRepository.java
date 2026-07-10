package com.cloumy.trip.repository;

import com.cloumy.trip.dto.PublicRouteProjection;
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

    // 공유 루트 가져오기 — 목적지 일치 + 공개 + 요청자 본인 루트 제외 + (bookmarkedOnly면 북마크한 것만).
    // 유저별 북마크 여부(isBookmarked)도 함께 내려줘야 해서 derived query 대신 네이티브 쿼리로 전환.
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
            countQuery = """
            SELECT COUNT(*) FROM routes r
            WHERE r.destination = :destination AND r.is_public = true AND r.user_id != :userId
              AND (:bookmarkedOnly = false OR EXISTS(
                    SELECT 1 FROM route_bookmarks rb2 WHERE rb2.route_id = r.id AND rb2.user_id = :userId))
            """,
            nativeQuery = true)
    Page<PublicRouteProjection> findPublicRoutes(
            @Param("destination") String destination,
            @Param("userId") UUID userId,
            @Param("bookmarkedOnly") boolean bookmarkedOnly,
            Pageable pageable);

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

    // 페르소나 자동추가 — 특정 테마들과 겹치는 유저의 루트 개수
    // (findSimilarRoutes와 동일 이유로 native query + string_to_array 캐스팅 필요)
    @Query(value = """
            SELECT COUNT(*) FROM routes
            WHERE user_id = :userId
              AND tags && string_to_array(:themesCsv, ',')
            """, nativeQuery = true)
    long countByUserIdAndThemesOverlap(@Param("userId") UUID userId, @Param("themesCsv") String themesCsv);
}

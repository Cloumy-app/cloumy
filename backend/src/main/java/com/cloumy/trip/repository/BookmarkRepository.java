package com.cloumy.trip.repository;

import com.cloumy.trip.dto.PlaceBrowseProjection;
import com.cloumy.trip.entity.Bookmark;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface BookmarkRepository extends JpaRepository<Bookmark, UUID> {

    boolean existsByUserIdAndPlaceId(UUID userId, UUID placeId);

    void deleteByUserIdAndPlaceId(UUID userId, UUID placeId);

    Page<Bookmark> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    // 공유 루트 가져오기 — "북마크한 장소" 탭. 다른 도시 북마크가 섞여 나오지 않게 목적지 도시
    // 30km 반경으로 필터링(browsePlaces와 동일 반경/좌표 순서).
    @Query(value = """
            SELECT p.id::text AS id, p.name AS name, p.address AS address,
                   ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
                   p.category_tags AS categoryTags, p.is_hidden_gem AS isHiddenGem, true AS isBookmarked
            FROM bookmarks b
            JOIN places p ON p.id = b.place_id
            WHERE b.user_id = :userId
              AND ST_DWithin(p.location, ST_MakePoint(:lng, :lat)::geography, 30000)
            ORDER BY b.created_at DESC
            """,
            countQuery = """
            SELECT COUNT(*) FROM bookmarks b
            JOIN places p ON p.id = b.place_id
            WHERE b.user_id = :userId
              AND ST_DWithin(p.location, ST_MakePoint(:lng, :lat)::geography, 30000)
            """,
            nativeQuery = true)
    Page<PlaceBrowseProjection> findBookmarksByCity(
            @Param("userId") UUID userId,
            @Param("lng") double lng,
            @Param("lat") double lat,
            Pageable pageable);
}

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

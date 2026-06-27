package com.cloumy.trip.repository;

import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.entity.Place;
import org.springframework.data.jpa.repository.JpaRepository;
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
}

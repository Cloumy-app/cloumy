package com.cloumy.trip.repository;

import com.cloumy.trip.dto.AccommodationProjection;
import com.cloumy.trip.entity.Accommodation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface AccommodationRepository extends JpaRepository<Accommodation, UUID> {

    // location(GEOGRAPHY)은 JPA가 못 다뤄서 save()로 못 넣음 — id를 서비스에서 미리
    // 생성해 네이티브 INSERT로 직접 처리. ST_MakePoint(경도, 위도) 순서 주의.
    @Modifying
    @Query(value = """
            INSERT INTO accommodations (id, route_id, name, address, location, check_in_date, check_out_date, source)
            VALUES (:id, :routeId, :name, :address, ST_MakePoint(:lng, :lat)::geography, :checkIn, :checkOut, :source)
            """, nativeQuery = true)
    void insertWithLocation(
            @Param("id") UUID id,
            @Param("routeId") UUID routeId,
            @Param("name") String name,
            @Param("address") String address,
            @Param("lng") double lng,
            @Param("lat") double lat,
            @Param("checkIn") LocalDate checkIn,
            @Param("checkOut") LocalDate checkOut,
            @Param("source") String source
    );

    @Query(value = """
            SELECT a.id::text                 AS id,
                   a.name                    AS name,
                   a.address                 AS address,
                   ST_Y(a.location::geometry) AS lat,
                   ST_X(a.location::geometry) AS lng,
                   a.check_in_date           AS checkInDate,
                   a.check_out_date          AS checkOutDate,
                   a.source                  AS source
            FROM accommodations a
            WHERE a.route_id = :routeId
            ORDER BY a.check_in_date
            """, nativeQuery = true)
    List<AccommodationProjection> findByRouteId(@Param("routeId") UUID routeId);
}

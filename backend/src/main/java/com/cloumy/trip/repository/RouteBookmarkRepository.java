package com.cloumy.trip.repository;

import com.cloumy.trip.entity.RouteBookmark;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RouteBookmarkRepository extends JpaRepository<RouteBookmark, UUID> {

    boolean existsByUserIdAndRouteId(UUID userId, UUID routeId);

    void deleteByUserIdAndRouteId(UUID userId, UUID routeId);
}

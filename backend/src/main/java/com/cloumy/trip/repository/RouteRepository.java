package com.cloumy.trip.repository;

import com.cloumy.trip.entity.Route;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RouteRepository extends JpaRepository<Route, UUID> {

    Page<Route> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);
}

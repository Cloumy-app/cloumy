package com.cloumy.trip.repository;

import com.cloumy.trip.entity.BudgetSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface BudgetSettingsRepository extends JpaRepository<BudgetSettings, UUID> {

    Optional<BudgetSettings> findByRouteId(UUID routeId);
}

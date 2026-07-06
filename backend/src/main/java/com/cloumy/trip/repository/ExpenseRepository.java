package com.cloumy.trip.repository;

import com.cloumy.trip.dto.CategoryTotalProjection;
import com.cloumy.trip.entity.Expense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ExpenseRepository extends JpaRepository<Expense, UUID> {

    List<Expense> findByRouteIdOrderByCreatedAtDesc(UUID routeId);

    @Query("SELECT COALESCE(SUM(e.actualAmount), 0) FROM Expense e WHERE e.routeId = :routeId")
    int sumActualAmountByRouteId(@Param("routeId") UUID routeId);

    // 여행 후 리포트 — 카테고리별 합계
    @Query("SELECT e.category AS category, COALESCE(SUM(e.actualAmount), 0) AS total "
            + "FROM Expense e WHERE e.routeId = :routeId GROUP BY e.category")
    List<CategoryTotalProjection> sumByCategory(@Param("routeId") UUID routeId);
}

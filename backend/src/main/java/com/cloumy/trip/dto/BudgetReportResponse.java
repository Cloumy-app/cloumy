package com.cloumy.trip.dto;

import java.util.List;

public record BudgetReportResponse(
        int plannedTotal, // "현지 활동비" 단일 항목 — 카테고리 구분 없음
        List<CategoryTotal> unplannedByCategory
) {
    public record CategoryTotal(String category, int total) {}
}

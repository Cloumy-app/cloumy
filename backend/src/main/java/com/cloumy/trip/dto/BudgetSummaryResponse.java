package com.cloumy.trip.dto;

// totalBudget이 null이면 이 루트에 예산이 설정되지 않은 것(에러 아님) — 프론트가 "예산 설정하기" CTA로 분기
public record BudgetSummaryResponse(
        Integer totalBudget,
        Double foodRatio,
        Double transportRatio,
        Double activityRatio,
        Double etcRatio,
        int plannedTotal,
        int unplannedTotal,
        Integer remaining
) {}

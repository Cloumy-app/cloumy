package com.cloumy.trip.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;

public record RouteGenRequest(
        @NotBlank String destination,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate,
        @NotBlank String groupType,
        @NotBlank String budgetLevel,
        List<String> tags,
        @DecimalMin("0.0") @DecimalMax("1.0") Double hiddenGemRatio,
        String density,
        @Pattern(regexp = "transit|car|walk", message = "transportMode는 transit/car/walk 중 하나여야 합니다")
        String transportMode,
        List<@Valid AccommodationCreateRequest> accommodations,
        // 숙박비 제외 현지 활동/식사 예산 — 선택 사항(숙소 선택과 동일 UX, null이면 예산 기능 자체를 건너뜀)
        @Min(1) Integer totalBudget
) {
    @AssertTrue(message = "종료일은 시작일 이후여야 합니다")
    public boolean isDateRangeValid() {
        return startDate == null || endDate == null || endDate.isAfter(startDate);
    }

    public int nights() {
        return (int) ChronoUnit.DAYS.between(startDate, endDate);
    }

    public List<AccommodationCreateRequest> accommodationsOrEmpty() {
        return accommodations != null ? accommodations : List.of();
    }
}

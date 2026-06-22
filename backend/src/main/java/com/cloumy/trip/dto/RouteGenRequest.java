package com.cloumy.trip.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;

public record RouteGenRequest(
        @NotBlank String destination,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate,
        @NotBlank String groupType,
        @NotBlank String budgetLevel,
        List<String> tags
) {
    @AssertTrue(message = "종료일은 시작일 이후여야 합니다")
    public boolean isDateRangeValid() {
        return startDate == null || endDate == null || endDate.isAfter(startDate);
    }

    public int nights() {
        return (int) ChronoUnit.DAYS.between(startDate, endDate);
    }
}

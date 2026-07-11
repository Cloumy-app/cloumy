package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record CreateBudgetRequest(
        @NotNull @Min(1) Integer totalBudget
) {}

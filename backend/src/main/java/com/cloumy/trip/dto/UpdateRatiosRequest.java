package com.cloumy.trip.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

public record UpdateRatiosRequest(
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double foodRatio,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double transportRatio,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double activityRatio,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double etcRatio
) {}

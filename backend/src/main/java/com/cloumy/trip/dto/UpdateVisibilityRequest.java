package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateVisibilityRequest(
        @NotNull Boolean isPublic
) {}

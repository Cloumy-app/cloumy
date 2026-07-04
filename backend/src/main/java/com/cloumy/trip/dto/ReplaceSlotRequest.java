package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record ReplaceSlotRequest(
        @NotNull UUID placeId,
        Integer estimatedCost,
        String reason
) {}

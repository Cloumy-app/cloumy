package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record FixedSlotRequest(
        @NotNull UUID placeId,
        @NotNull @Min(1) Integer dayNumber
) {}

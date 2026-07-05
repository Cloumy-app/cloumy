package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record InsertSlotRequest(
        @NotNull UUID afterSlotId,
        @NotNull UUID placeId
) {}

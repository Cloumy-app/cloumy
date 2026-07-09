package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

public record ReorderSlotsRequest(
        @NotNull @Min(1) Integer dayNumber,
        @NotEmpty List<UUID> slotIds
) {}

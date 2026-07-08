package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

public record ReorderRoutesRequest(
        @NotEmpty List<UUID> routeIds
) {}

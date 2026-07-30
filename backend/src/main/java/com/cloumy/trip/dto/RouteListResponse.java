package com.cloumy.trip.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.UUID;

public record RouteListResponse(
        UUID id,
        String title,
        String destination,
        LocalDate startDate,
        LocalDate endDate,
        int nights,
        LocalDateTime createdAt,
        boolean isPublic,
        OffsetDateTime departureAt,
        OffsetDateTime returnAt
) {}

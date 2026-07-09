package com.cloumy.trip.dto;

import java.util.UUID;

public record PublicRouteResponse(
        UUID id,
        String title,
        String destination,
        int nights,
        String[] tags,
        int saveCount
) {}

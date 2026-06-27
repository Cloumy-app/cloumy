package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

public record SlotAlternativeResponse(
        @JsonAlias("place_name") String placeName,
        String reason,
        @JsonAlias("estimated_cost") int estimatedCost,
        double lat,
        double lng
) {}

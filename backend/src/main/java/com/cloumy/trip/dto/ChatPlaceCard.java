package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

public record ChatPlaceCard(
        @JsonAlias("place_id") String placeId,
        String name,
        String tags,
        @JsonAlias("is_hidden_gem") boolean isHiddenGem,
        @JsonAlias("avg_duration_minutes") Integer avgDurationMinutes
) {}

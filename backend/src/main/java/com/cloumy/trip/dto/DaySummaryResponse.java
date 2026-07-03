package com.cloumy.trip.dto;

import com.cloumy.trip.entity.RouteDaySummary;

public record DaySummaryResponse(
        int dayNumber,
        String summary
) {
    public static DaySummaryResponse from(RouteDaySummary entity) {
        return new DaySummaryResponse(entity.getDayNumber(), entity.getSummary());
    }
}

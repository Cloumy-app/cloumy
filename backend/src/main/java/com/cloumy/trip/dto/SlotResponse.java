package com.cloumy.trip.dto;

import java.util.UUID;

public record SlotResponse(
        UUID id,
        String placeId,
        int dayNumber,
        int orderIndex,
        boolean pinned,
        String startTime,
        Integer durationMinutes,
        Integer estimatedCost,
        String transportToNext,
        Integer transportMinutes,
        String transitSummary,
        String tips,
        String placeName,
        String address,
        double lat,
        double lng,
        Integer avgDurationMinutes
) {
    public static SlotResponse from(SlotProjection p) {
        return new SlotResponse(
                UUID.fromString(p.getId()),
                p.getPlaceId(),
                p.getDayNumber(),
                p.getOrderIndex(),
                Boolean.TRUE.equals(p.getPinned()),
                p.getStartTime(),
                p.getDurationMinutes(),
                p.getEstimatedCost(),
                p.getTransportToNext(),
                p.getTransportMinutes(),
                p.getTransitSummary(),
                p.getTips(),
                p.getPlaceName(),
                p.getAddress(),
                p.getLat() != null ? p.getLat() : 0.0,
                p.getLng() != null ? p.getLng() : 0.0,
                p.getAvgDurationMinutes()
        );
    }
}

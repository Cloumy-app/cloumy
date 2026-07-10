package com.cloumy.trip.dto;

import java.util.List;
import java.util.UUID;

public record PlaceDetailResponse(
        UUID id,
        String name,
        String address,
        double lat,
        double lng,
        Integer avgDurationMinutes,
        boolean isHiddenGem,
        List<String> categoryTags
) {
    public static PlaceDetailResponse from(PlaceProjection p) {
        return new PlaceDetailResponse(
                UUID.fromString(p.getId()),
                p.getName(),
                p.getAddress(),
                p.getLat() != null ? p.getLat() : 0.0,
                p.getLng() != null ? p.getLng() : 0.0,
                p.getAvgDurationMinutes(),
                Boolean.TRUE.equals(p.getIsHiddenGem()),
                p.getCategoryTags() != null ? List.of(p.getCategoryTags()) : List.of()
        );
    }
}

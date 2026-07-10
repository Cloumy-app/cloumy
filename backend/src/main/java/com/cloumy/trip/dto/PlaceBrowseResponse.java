package com.cloumy.trip.dto;

import java.util.List;
import java.util.UUID;

public record PlaceBrowseResponse(
        UUID id,
        String name,
        String address,
        double lat,
        double lng,
        List<String> categoryTags,
        boolean isHiddenGem,
        boolean isBookmarked
) {
    public static PlaceBrowseResponse from(PlaceBrowseProjection p) {
        return new PlaceBrowseResponse(
                UUID.fromString(p.getId()),
                p.getName(),
                p.getAddress(),
                p.getLat() != null ? p.getLat() : 0,
                p.getLng() != null ? p.getLng() : 0,
                p.getCategoryTags() != null ? List.of(p.getCategoryTags()) : List.of(),
                Boolean.TRUE.equals(p.getIsHiddenGem()),
                Boolean.TRUE.equals(p.getIsBookmarked())
        );
    }
}

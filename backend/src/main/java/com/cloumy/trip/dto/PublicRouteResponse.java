package com.cloumy.trip.dto;

import java.util.UUID;

public record PublicRouteResponse(
        UUID id,
        String title,
        String destination,
        int nights,
        String[] tags,
        int saveCount,
        boolean isBookmarked
) {
    public static PublicRouteResponse from(PublicRouteProjection p) {
        return new PublicRouteResponse(
                UUID.fromString(p.getId()),
                p.getTitle(),
                p.getDestination(),
                p.getNights(),
                p.getTags() != null ? p.getTags() : new String[]{},
                p.getSaveCount(),
                Boolean.TRUE.equals(p.getIsBookmarked())
        );
    }
}

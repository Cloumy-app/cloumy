package com.cloumy.trip.dto;

import java.time.LocalDate;
import java.util.UUID;

public record AccommodationResponse(
        UUID id,
        String name,
        String address,
        double lat,
        double lng,
        LocalDate checkInDate,
        LocalDate checkOutDate,
        String source
) {
    public static AccommodationResponse from(AccommodationProjection p) {
        return new AccommodationResponse(
                UUID.fromString(p.getId()),
                p.getName(),
                p.getAddress(),
                p.getLat() != null ? p.getLat() : 0.0,
                p.getLng() != null ? p.getLng() : 0.0,
                p.getCheckInDate(),
                p.getCheckOutDate(),
                p.getSource()
        );
    }
}

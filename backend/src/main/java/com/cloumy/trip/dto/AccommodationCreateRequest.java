package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.time.LocalDate;

public record AccommodationCreateRequest(
        @NotBlank String name,
        String address,
        @NotNull Double lat,
        @NotNull Double lng,
        @NotNull LocalDate checkInDate,
        @NotNull LocalDate checkOutDate,
        @NotBlank @Pattern(regexp = "kakao|manual") String source
) {}

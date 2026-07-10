package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record ExternalPlaceRequest(
        @NotBlank String name,
        String address,
        @NotNull Double lat,
        @NotNull Double lng,
        @NotBlank @Pattern(regexp = "manual|kakao|event") String source
) {}

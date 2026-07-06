package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record ChatRequest(
        @NotNull UUID routeId,
        @NotBlank String message,
        Double lat,
        Double lng,
        String language // ko/en/ja/zh — 앱 설정 언어(선택 사항)
) {}

package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record ChatRequest(
        @NotNull UUID routeId,
        @NotBlank String message,
        Double lat,
        Double lng,
        String language, // ko/en/ja/zh — 앱 설정 언어(선택 사항)
        // 프로액티브 배너 탭 직후 첫 메시지에만 실려온다(선택 사항) — FastAPI가 시스템 프롬프트에 덧붙인다
        String proactiveContext
) {}

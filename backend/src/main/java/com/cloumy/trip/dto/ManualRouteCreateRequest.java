package com.cloumy.trip.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;

// 루트/커뮤니티 탭 신설 — 수동 루트 작성 폼 제출 페이로드
public record ManualRouteCreateRequest(
        @NotBlank String title,
        @NotBlank String destination,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate,
        @NotEmpty @Valid List<ManualSlotRequest> slots
) {}

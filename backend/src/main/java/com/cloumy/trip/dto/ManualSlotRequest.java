package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

// 루트/커뮤니티 탭 신설 — 수동 루트 작성 시 장소 하나(day 배정 포함)
public record ManualSlotRequest(@NotNull UUID placeId, @Min(1) int dayNumber) {}

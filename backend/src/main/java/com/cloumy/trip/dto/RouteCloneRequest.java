package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

// 루트/커뮤니티 탭 신설 — 전체 가져오기(clone) 시 새로 받는 값은 시작일뿐, 박수는 원본 고정값 사용
public record RouteCloneRequest(@NotNull LocalDate startDate) {}

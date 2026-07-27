package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

// 계측용 — DB 저장 없이 로그만 남긴다(베타 50명 규모라 grep으로 충분, §계측)
public record ProactiveFeedbackRequest(
        @NotBlank String type,
        @NotBlank @Pattern(regexp = "tapped|dismissed") String action
) {}

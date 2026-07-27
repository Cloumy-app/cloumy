package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

// 계측용 — DB 저장 없이 로그만 남긴다(베타 50명 규모라 grep으로 충분, §계측)
// action: tapped(배너 탭) / dismissed(배너 닫음) / auto_shown(홈 배너를 거치지 않고
// 챗봇에 직접 진입해 자동으로 말을 건 경우 — tapped와 섞으면 배너 탭률이 왜곡된다)
public record ProactiveFeedbackRequest(
        @NotBlank String type,
        @NotBlank @Pattern(regexp = "tapped|dismissed|auto_shown") String action
) {}

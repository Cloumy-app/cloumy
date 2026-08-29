package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

import java.util.UUID;

// action: tapped(배너 탭) / dismissed(배너 닫음) / auto_shown(홈 배너를 거치지 않고
// 챗봇에 직접 진입해 자동으로 말을 건 경우 — tapped와 섞으면 배너 탭률이 왜곡된다)
// dismissed는 계측용 로그에 그치지 않는다 — ProactiveController가 Redis SET에 기록해
// 같은 날 같은 개입(+장소)의 재노출을 막는다(§계측 + 필터링).
public record ProactiveFeedbackRequest(
        // ChatRequest.ProactiveContext.type과 같은 화이트리스트 공유 — type 검증을 한 곳(ProactiveIntervention)으로 모은다.
        @NotBlank @Pattern(regexp = ProactiveIntervention.TYPE_PATTERN) String type,
        @NotBlank @Pattern(regexp = "tapped|dismissed|auto_shown") String action,
        // Phase C의 신규 6종은 전부 장소 단위라 같은 type이어도 장소가 다르면 별개로 닫혀야 한다.
        // 장소 무관 규칙(기존 9종)은 null.
        UUID placeId
) {}

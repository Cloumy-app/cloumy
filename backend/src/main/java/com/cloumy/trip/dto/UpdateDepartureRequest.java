package com.cloumy.trip.dto;

import java.time.LocalDateTime;

// 출국 일시(선택 입력) — departureAt이 null이면 미입력 상태로 되돌린다.
// UpdateVisibilityRequest와 달리 @NotNull을 붙이지 않는다(지우는 것도 유효한 요청).
public record UpdateDepartureRequest(LocalDateTime departureAt) {}

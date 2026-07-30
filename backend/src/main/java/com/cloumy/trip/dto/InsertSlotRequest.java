package com.cloumy.trip.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record InsertSlotRequest(
        UUID afterSlotId,            // null이면 dayNumber 맨 앞에 삽입 (예: 첫 일정 앞에 끼워 넣기, 빈 Day)
        // afterSlotId 유무와 상관없이 항상 필수로 둔다 — 필드가 조건부로 필수가 되면
        // 클라이언트가 "언제 보내야 하는지" 매번 판단해야 해서 계약이 복잡해진다.
        // afterSlotId가 있으면 서버가 그 슬롯의 dayNumber를 그대로 쓰고 이 값은 무시한다.
        @NotNull Integer dayNumber,
        @NotNull UUID placeId,
        String reason
) {}

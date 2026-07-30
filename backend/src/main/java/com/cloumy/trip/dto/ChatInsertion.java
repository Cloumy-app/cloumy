package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

// FastAPI가 정한 삽입 자리를 로직 없이 그대로 통과시킨다 — 한국어 문구는 서버가 만들지 않고
// 앱이 source별 i18n 문구 + 슬롯 캐시의 장소명으로 조립한다("판단은 규칙이, 표현은 앱이").
public record ChatInsertion(
        int day,
        @JsonAlias("after_slot_id") String afterSlotId,
        // "conversation"(대화에서 장소를 특정 — 앱이 확인 없이 바로 삽입하는 유일한 값)
        // | "conversation_day"(Day만 특정 — 자리는 서버가 고른 그 Day 맨 뒤)
        // | "estimated" | "default"
        String source
) {}

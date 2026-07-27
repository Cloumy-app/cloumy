package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

// intervention이 null이면 "지금은 개입 없음" — FastAPI 응답을 그대로 옮긴 형태.
// AiServiceClient.proactive()가 타임아웃·5xx를 삼킬 때도 이 empty()를 반환한다(예외로 승격 금지).
// ALWAYS는 application.yml의 전역 non_null을 덮는다 — 개입이 없을 때도 `{"intervention": null}`을
// 그대로 내보내 "필드 누락"이 아니라 "개입 없음"임을 응답만 보고 알 수 있게 한다(04-api-spec.md 명세).
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProactiveResponse(ProactiveIntervention intervention) {

    public static ProactiveResponse empty() {
        return new ProactiveResponse(null);
    }
}

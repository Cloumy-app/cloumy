package com.cloumy.trip.dto;

import java.util.Map;

// FastAPI proactive_service의 규칙 하나가 뽑은 후보 — type만 있고 문구는 없다(판단은 규칙이,
// 표현은 앱이 한다). params는 규칙마다 필드가 달라 Map으로 그대로 흘려보내고 프론트가
// i18next 보간으로 조립한다.
public record ProactiveIntervention(String type, Map<String, Object> params) {

    // 15종 type 화이트리스트 — ChatRequest.ProactiveContext와 ProactiveFeedbackRequest.type이
    // 공유한다. 원천은 ai/app/models/schemas.py의 ProactiveContext 태그드 유니온(discriminator="type").
    // params 스키마 자체는 규칙마다 달라 여기 복제하지 않는다 — 그건 FastAPI(Pydantic)가 검증한다.
    public static final String TYPE_PATTERN =
            "PRE_TRIP_BRIEFING|FLIGHT_DEPARTURE|RETURN_DEPARTURE|DEPARTURE_SOON|EMPTY_DAY|"
                    + "WEATHER_ALERT|BUDGET_OVER|BOOKMARK_NEARBY|FREE_GAP|LAST_TRANSIT|CLOSED_DAY|"
                    + "BREAK_TIME|RESERVATION_WALL|PAYMENT_WALL|LAST_ENTRY";
}

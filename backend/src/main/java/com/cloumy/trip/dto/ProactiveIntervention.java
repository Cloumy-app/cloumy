package com.cloumy.trip.dto;

import java.util.Map;

// FastAPI proactive_service의 규칙 하나가 뽑은 후보 — type만 있고 문구는 없다(판단은 규칙이,
// 표현은 앱이 한다). params는 규칙마다 필드가 달라 Map으로 그대로 흘려보내고 프론트가
// i18next 보간으로 조립한다.
public record ProactiveIntervention(String type, Map<String, Object> params) {}

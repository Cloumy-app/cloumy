package com.cloumy.trip.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.util.Map;
import java.util.UUID;

public record ChatRequest(
        @NotNull UUID routeId,
        @NotBlank String message,
        Double lat,
        Double lng,
        String language, // ko/en/ja/zh — 앱 설정 언어(선택 사항)
        // 프로액티브 배너 탭 직후 첫 메시지에만 실려온다(선택 사항). 앱은 완성 문장이 아니라
        // type+params만 보내고, 서버가 문장을 조립한다(FastAPI ProactiveContext) — 완성 문장을
        // 그대로 받아 시스템 프롬프트에 붙이면 임의 지시를 주입하는 통로가 된다.
        @Valid ProactiveContext proactive
) {
    // type 화이트리스트만 Spring이 본다. params 스키마는 FastAPI(Pydantic 태그드 유니온)가
    // 검증한다 — 규칙마다 필드가 달라 Java에 복제하면 규칙 추가 시 변경 지점이 3배가 된다.
    public record ProactiveContext(
            @NotBlank @Pattern(regexp = ProactiveIntervention.TYPE_PATTERN) String type,
            @NotNull Map<String, Object> params
    ) {}
}

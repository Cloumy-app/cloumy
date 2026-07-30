package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

// 활성 루트가 없을 때 route: null을 명시 노출한다(전역 non_null 설정을 덮는다).
// ProactiveResponse와 같은 이유 — ApiResponse에 ALWAYS를 붙이면 전 엔드포인트가 회귀하므로
// 여기 래퍼 DTO에만 붙인다.
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ActiveRouteResponse(RouteListResponse route) {}

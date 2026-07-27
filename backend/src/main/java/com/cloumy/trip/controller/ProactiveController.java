package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.ProactiveFeedbackRequest;
import com.cloumy.trip.dto.ProactiveResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.service.AiServiceClient;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/v1/routes/{routeId}")
@RequiredArgsConstructor
public class ProactiveController {

    private final RouteRepository routeRepository;
    private final AiServiceClient aiServiceClient;

    @GetMapping("/proactive")
    public ApiResponse<ProactiveResponse> proactive(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        verifyOwnership(routeId, userId);
        return ApiResponse.ok(aiServiceClient.proactive(userId.toString(), routeId.toString()));
    }

    // 계측 — proactive_tapped/proactive_dismissed. DB 저장 없이 로그만 남긴다(§계측)
    @PostMapping("/proactive/feedback")
    public ApiResponse<Void> feedback(
            @PathVariable UUID routeId,
            @RequestBody @Valid ProactiveFeedbackRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        verifyOwnership(routeId, userId);
        log.info("[proactive] {} type={} route={} user={}", req.action(), req.type(), routeId, userId);
        return ApiResponse.ok();
    }

    // 소유권 검증 — ChatController와 동일한 findById + userId 비교 패턴
    private void verifyOwnership(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.ChatRequest;
import com.cloumy.trip.dto.ChatResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.service.AiServiceClient;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class ChatController {

    private final RouteRepository routeRepository;
    private final AiServiceClient aiServiceClient;

    @PostMapping("/chat")
    public ApiResponse<ChatResponse> chat(
            @RequestBody @Valid ChatRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());

        // 소유권 검증 — RouteService.getRoute()와 동일한 findById + userId 비교 패턴
        Route route = routeRepository.findById(req.routeId())
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }

        ChatResponse chatResponse = aiServiceClient.chat(
                userId.toString(), req.routeId().toString(), req.message(), req.lat(), req.lng(),
                req.language(), req.proactive());
        return ApiResponse.ok(chatResponse);
    }
}

package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.service.AiServiceClient;
import com.cloumy.trip.service.RouteService;
import com.cloumy.trip.service.RouteSlotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class RouteController {

    private final RouteService routeService;
    private final RouteSlotService routeSlotService;
    private final AiServiceClient aiServiceClient;

    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    @GetMapping("/routes")
    public ApiResponse<Page<RouteListResponse>> getMyRoutes(
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 10, sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.getMyRoutes(userId, pageable));
    }

    @DeleteMapping("/routes/{routeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRoute(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        routeService.deleteRoute(routeId, UUID.fromString(user.userId()));
    }

    @PostMapping(value = "/routes/generate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generate(
            @RequestBody @Valid RouteGenRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());

        // 패스 검증 + Route 엔티티 저장 (스트리밍 전 — 실패 시 SSE 대신 HTTP 에러 반환)
        Route route = routeService.createRoute(req, userId);

        SseEmitter emitter = new SseEmitter(120_000L);

        executor.execute(() -> {
            try {
                // 루트 ID를 첫 이벤트로 전송
                emitter.send(SseEmitter.event().name("route_id").data(route.getId().toString()));

                aiServiceClient.streamRoute(
                        req,
                        line -> {
                            try {
                                emitter.send(SseEmitter.event().data(line));
                            } catch (IOException e) {
                                emitter.completeWithError(e);
                                return;
                            }
                            // SSE 전송과 별개로 슬롯 저장 — 저장 실패는 스트림에 영향 없음
                            try {
                                routeSlotService.saveStreamingSlot(route.getId(), line);
                            } catch (Exception e) {
                                log.warn("슬롯 저장 실패 (무시): {}", e.getMessage());
                            }
                        },
                        () -> {
                            // 클라이언트에 스트림 종료 신호 전송 (일반 message로 — named event는 클라이언트에서 미수신)
                            try {
                                emitter.send(SseEmitter.event().data("{\"done\":true}"));
                            } catch (IOException e) {
                                // 클라이언트가 이미 끊긴 경우 무시
                            }
                            emitter.complete();
                        },
                        emitter::completeWithError
                );
            } catch (IOException e) {
                emitter.completeWithError(e);
            }
        });

        emitter.onTimeout(emitter::complete);
        return emitter;
    }
}

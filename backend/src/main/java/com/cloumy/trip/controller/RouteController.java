package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.service.AiServiceClient;
import com.cloumy.trip.service.RouteService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class RouteController {

    private final RouteService routeService;
    private final AiServiceClient aiServiceClient;

    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

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
                            }
                        },
                        emitter::complete,
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

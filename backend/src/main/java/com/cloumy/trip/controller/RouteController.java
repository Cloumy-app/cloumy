package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.DaySummaryResponse;
import com.cloumy.trip.dto.PublicRouteResponse;
import com.cloumy.trip.dto.ReorderRoutesRequest;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
import com.cloumy.trip.dto.SlotResponse;
import com.cloumy.trip.dto.UpdateVisibilityRequest;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.service.AiServiceClient;
import com.cloumy.trip.service.FallbackRouteService;
import com.cloumy.trip.service.RouteDaySummaryService;
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
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
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
    private final RouteDaySummaryService routeDaySummaryService;
    private final AiServiceClient aiServiceClient;
    private final FallbackRouteService fallbackRouteService;

    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    @GetMapping("/routes")
    public ApiResponse<Page<RouteListResponse>> getMyRoutes(
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 10, sort = "displayOrder", direction = Sort.Direction.ASC) Pageable pageable
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.getMyRoutes(userId, pageable));
    }

    @GetMapping("/routes/{routeId}")
    public ApiResponse<RouteListResponse> getRoute(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.getRoute(routeId, userId));
    }

    @GetMapping("/routes/{routeId}/day-summaries")
    public ApiResponse<List<DaySummaryResponse>> getDaySummaries(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeDaySummaryService.getSummaries(routeId, userId));
    }

    @DeleteMapping("/routes/{routeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRoute(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        routeService.deleteRoute(routeId, UUID.fromString(user.userId()));
    }

    @PatchMapping("/routes/reorder")
    public ApiResponse<List<RouteListResponse>> reorderRoutes(
            @RequestBody @Valid ReorderRoutesRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.reorderRoutes(userId, req.routeIds()));
    }

    @PatchMapping("/routes/{routeId}/visibility")
    public ApiResponse<Void> updateVisibility(
            @PathVariable UUID routeId,
            @RequestBody @Valid UpdateVisibilityRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        routeService.updateVisibility(routeId, userId, req.isPublic());
        return ApiResponse.ok(null);
    }

    // 공유 루트 가져오기 — 목적지 일치 + 공개 + 요청자 본인 제외, save_count DESC 정렬
    @GetMapping("/routes/public")
    public ApiResponse<Page<PublicRouteResponse>> getPublicRoutes(
            @RequestParam String destination,
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 10, sort = "saveCount", direction = Sort.Direction.DESC) Pageable pageable
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(routeService.getPublicRoutes(destination, userId, pageable));
    }

    // 공유 루트 가져오기 — 그 루트가 공개일 때만 슬롯 목록 반환. RouteSlotController(/slots 하위)와
    // 별도로 여기 둔 이유: /routes/{routeId}/public-slots 경로가 /slots에 중첩되지 않게 하기 위함
    @GetMapping("/routes/{routeId}/public-slots")
    public ApiResponse<List<SlotResponse>> getPublicSlots(@PathVariable UUID routeId) {
        return ApiResponse.ok(routeSlotService.getPublicSlots(routeId));
    }

    @PostMapping(value = "/routes/generate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generate(
            @RequestBody @Valid RouteGenRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());

        // 패스 검증 + Route 엔티티 저장 (스트리밍 전 — 실패 시 SSE 대신 HTTP 에러 반환)
        Route route = routeService.createRoute(req, userId);

        // 사전 고정 슬롯 기반 — AI 스트리밍 시작 전 확정 장소를 pinned=true로 즉시 저장
        // (역시 스트리밍 전이라 검증 실패 시 SSE 대신 HTTP 에러로 반환됨)
        List<RouteSlotService.FixedSlotResult> fixedSlots =
                routeSlotService.createFixedSlots(route.getId(), req.nights(), req.fixedSlotsOrEmpty());

        // 공유 루트 가져오기 — 새 루트 생성 성공 직후 원본 루트들의 save_count 증가.
        // fixedSlots 저장과 같은 타이밍(스트리밍 전) — 실제 AI 생성 성공 여부와 무관하게
        // "이 루트가 그 원본을 참고해 만들어졌다"는 사실 자체를 카운트한다.
        routeService.incrementSaveCounts(req.sourceRouteIdsOrEmpty());

        SseEmitter emitter = new SseEmitter(120_000L);

        executor.execute(() -> {
            try {
                // 루트 ID를 첫 이벤트로 전송
                emitter.send(SseEmitter.event().name("route_id").data(route.getId().toString()));

                aiServiceClient.streamRoute(
                        req,
                        fixedSlots,
                        line -> {
                            try {
                                emitter.send(SseEmitter.event().data(line));
                            } catch (IOException e) {
                                emitter.completeWithError(e);
                                return;
                            }
                            // SSE 전송과 별개로 슬롯 저장 — 저장 실패는 스트림에 영향 없음
                            try {
                                routeSlotService.saveStreamingLine(route.getId(), line);
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
                        error -> handleStreamFailure(req, route, emitter, error)
                );
            } catch (IOException e) {
                emitter.completeWithError(e);
            }
        });

        emitter.onTimeout(emitter::complete);
        return emitter;
    }

    // FastAPI 스트리밍 실패 시 폴백 — 2차: DB 유사 루트를 찾아 대신 흘려보냄, 없으면 3차: 기존처럼 스트림 에러 종료
    // (진짜 HTTP 503은 route_id 이벤트로 이미 200 응답이 커밋돼 있어 불가능 — completeWithError가
    // react-native-sse의 error 리스너로 이어지는 기존 경로를 그대로 씀)
    private void handleStreamFailure(RouteGenRequest req, Route route, SseEmitter emitter, Throwable error) {
        log.warn("FastAPI 스트리밍 실패 — 폴백 시도: {}", error.getMessage());
        fallbackRouteService.findFallbackLines(req).ifPresentOrElse(
                lines -> {
                    for (String line : lines) {
                        try {
                            emitter.send(SseEmitter.event().data(line));
                        } catch (IOException e) {
                            emitter.completeWithError(e);
                            return;
                        }
                        try {
                            routeSlotService.saveStreamingLine(route.getId(), line);
                        } catch (Exception e) {
                            log.warn("폴백 슬롯 저장 실패 (무시): {}", e.getMessage());
                        }
                    }
                    try {
                        emitter.send(SseEmitter.event().data("{\"done\":true}"));
                    } catch (IOException e) {
                        // 클라이언트가 이미 끊긴 경우 무시
                    }
                    emitter.complete();
                },
                () -> emitter.completeWithError(error)
        );
    }
}

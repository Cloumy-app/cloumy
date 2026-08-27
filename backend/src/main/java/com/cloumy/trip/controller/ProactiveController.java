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
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/v1/routes/{routeId}")
@RequiredArgsConstructor
public class ProactiveController {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration DISMISS_TTL = Duration.ofHours(48);

    private final RouteRepository routeRepository;
    private final AiServiceClient aiServiceClient;
    private final StringRedisTemplate redisTemplate;

    @GetMapping("/proactive")
    public ApiResponse<ProactiveResponse> proactive(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        verifyOwnership(routeId, userId);
        return ApiResponse.ok(aiServiceClient.proactive(userId.toString(), routeId.toString()));
    }

    // 계측 — proactive_tapped/proactive_dismissed(§계측). dismissed는 추가로 Redis에 기록해
    // 같은 날 같은 개입(+장소) 재노출을 막는다(recordDismissal).
    @PostMapping("/proactive/feedback")
    public ApiResponse<Void> feedback(
            @PathVariable UUID routeId,
            @RequestBody @Valid ProactiveFeedbackRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        verifyOwnership(routeId, userId);
        log.info("[proactive] {} type={} route={} user={}", req.action(), req.type(), routeId, userId);
        if ("dismissed".equals(req.action())) {
            recordDismissal(userId, routeId, req);
        }
        return ApiResponse.ok();
    }

    // 프론트 MMKV만으론 못 막는다 — _select가 priority 최솟값 1개만 반환하는데 상태형 규칙
    // (CLOSED_DAY 등)은 하루 종일 참이라, 서버가 안 걸러주면 유저가 닫은 개입 하나가
    // 그날 나머지 개입을 전부 가린다.
    private void recordDismissal(UUID userId, UUID routeId, ProactiveFeedbackRequest req) {
        // 도커 컨테이너는 UTC라 LocalDate.now()만 쓰면 자정 근처에 FastAPI(_KST)와 하루 어긋난다
        // (RouteService.java:263-264와 같은 이유).
        String key = "proactive:dismissed:%s:%s:%s"
                .formatted(userId, routeId, LocalDate.now(KST));
        String member = req.type() + ":" + (req.placeId() != null ? req.placeId() : "-");
        try {
            redisTemplate.opsForSet().add(key, member);
            redisTemplate.expire(key, DISMISS_TTL);
        } catch (Exception e) {
            // fail-open — 최악이 "닫은 배너가 다시 뜬다"라 개입 조회를 막을 이유가 없다
            log.warn("dismiss 기록 실패 — 무시: {}", e.getMessage());
        }
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

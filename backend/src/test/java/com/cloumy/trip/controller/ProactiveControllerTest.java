package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.ProactiveFeedbackRequest;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.service.AiServiceClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProactiveControllerTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Mock
    private RouteRepository routeRepository;

    @Mock
    private AiServiceClient aiServiceClient;

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private SetOperations<String, String> setOperations;

    @InjectMocks
    private ProactiveController proactiveController;

    private Route ownedRoute(UUID userId, UUID routeId) {
        Route route = Route.builder()
                .userId(userId)
                .title("테스트 루트")
                .destination("서울")
                .startDate(LocalDate.now())
                .endDate(LocalDate.now().plusDays(2))
                .nights(2)
                .groupType("SOLO")
                .budgetLevel("MEDIUM")
                .displayOrder(0)
                .build();
        // @GeneratedValue라 저장 전엔 id가 비어있음 — 테스트 편의상 직접 세팅
        ReflectionTestUtils.setField(route, "id", routeId);
        return route;
    }

    @Test
    void dismissedWithNullPlaceIdRecordsDashPlaceholder() {
        // placeId가 null이면 SADD 멤버가 문자열 "null"이 아니라 "TYPE:-" 형태여야 한다
        UUID userId = UUID.randomUUID();
        UUID routeId = UUID.randomUUID();
        CloudmyUserDetails principal = new CloudmyUserDetails(userId.toString(), "USER");
        ProactiveFeedbackRequest req = new ProactiveFeedbackRequest("CLOSED_DAY", "dismissed", null);

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(ownedRoute(userId, routeId)));
        when(redisTemplate.opsForSet()).thenReturn(setOperations);

        ApiResponse<Void> response = proactiveController.feedback(routeId, req, principal);

        assertThat(response.success()).isTrue();

        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> memberCaptor = ArgumentCaptor.forClass(String.class);
        verify(setOperations).add(keyCaptor.capture(), memberCaptor.capture());
        assertThat(memberCaptor.getValue()).isEqualTo("CLOSED_DAY:-");

        // 키 형식: proactive:dismissed:{userId}:{routeId}:{KST 기준 날짜}
        String expectedKey = "proactive:dismissed:%s:%s:%s".formatted(userId, routeId, LocalDate.now(KST));
        assertThat(keyCaptor.getValue()).isEqualTo(expectedKey);

        ArgumentCaptor<Duration> ttlCaptor = ArgumentCaptor.forClass(Duration.class);
        verify(redisTemplate).expire(eq(expectedKey), ttlCaptor.capture());
        assertThat(ttlCaptor.getValue()).isEqualTo(Duration.ofHours(48));
    }

    @Test
    void dismissedWithPlaceIdRecordsMemberWithUuid() {
        // placeId가 있으면 멤버가 "TYPE:{uuid}" 형태로 기록돼야 한다 — Phase C 신규 6종은 장소 단위 dismiss
        UUID userId = UUID.randomUUID();
        UUID routeId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();
        CloudmyUserDetails principal = new CloudmyUserDetails(userId.toString(), "USER");
        ProactiveFeedbackRequest req = new ProactiveFeedbackRequest("BOOKMARK_NEARBY", "dismissed", placeId);

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(ownedRoute(userId, routeId)));
        when(redisTemplate.opsForSet()).thenReturn(setOperations);

        proactiveController.feedback(routeId, req, principal);

        ArgumentCaptor<String> memberCaptor = ArgumentCaptor.forClass(String.class);
        verify(setOperations).add(any(), memberCaptor.capture());
        assertThat(memberCaptor.getValue()).isEqualTo("BOOKMARK_NEARBY:" + placeId);
    }

    @Test
    void tappedActionDoesNotRecordDismissal() {
        // action이 dismissed가 아니면 SADD 자체가 호출되지 않아야 한다
        UUID userId = UUID.randomUUID();
        UUID routeId = UUID.randomUUID();
        CloudmyUserDetails principal = new CloudmyUserDetails(userId.toString(), "USER");
        ProactiveFeedbackRequest req = new ProactiveFeedbackRequest("CLOSED_DAY", "tapped", null);

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(ownedRoute(userId, routeId)));

        ApiResponse<Void> response = proactiveController.feedback(routeId, req, principal);

        assertThat(response.success()).isTrue();
        verify(redisTemplate, never()).opsForSet();
    }

    @Test
    void redisFailureDuringDismissDoesNotPropagate() {
        // fail-open — 최악이 "닫은 배너가 다시 뜬다"라 Redis 장애가 API 응답 자체를 막으면 안 된다
        UUID userId = UUID.randomUUID();
        UUID routeId = UUID.randomUUID();
        CloudmyUserDetails principal = new CloudmyUserDetails(userId.toString(), "USER");
        ProactiveFeedbackRequest req = new ProactiveFeedbackRequest("CLOSED_DAY", "dismissed", null);

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(ownedRoute(userId, routeId)));
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(setOperations.add(any(), any())).thenThrow(new RuntimeException("redis down"));

        ApiResponse<Void> response = proactiveController.feedback(routeId, req, principal);

        assertThat(response.success()).isTrue();
    }
}

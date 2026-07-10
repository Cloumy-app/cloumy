package com.cloumy.auth.service;

import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserService userService;

    private User newUser(UUID userId) {
        User user = User.builder()
                .oauthProvider("dev")
                .oauthId("test-user")
                .nickname("테스트 유저")
                .profileImageUrl(null)
                .build();
        // 실제로 저장하지 않은 엔티티라 @GeneratedValue id가 비어있음 — 테스트 편의상 직접 세팅
        ReflectionTestUtils.setField(user, "id", userId);
        return user;
    }

    @Test
    void completingOnboardingWithValidTagsSetsOnboardingCompletedAt() {
        UUID userId = UUID.randomUUID();
        User user = newUser(userId);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));

        var response = userService.completeOnboarding(userId, List.of("K_FOOD_LOVER", "CAFE_HOPPER"));

        assertThat(response.personaTags()).containsExactly("K_FOOD_LOVER", "CAFE_HOPPER");
        assertThat(response.onboardingCompleted()).isTrue();
    }

    @Test
    void throwsWhenTagIsUndefined() {
        UUID userId = UUID.randomUUID();
        // 검증이 조회보다 먼저 실패하므로 userRepository는 호출되지 않음 — 스텁 불필요

        assertThatThrownBy(() -> userService.completeOnboarding(userId, List.of("NOT_A_REAL_TAG")))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> {
                    BusinessException ex = (BusinessException) e;
                    assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_PERSONA_TAG);
                });
    }

    @Test
    void skippingWithEmptyArrayStillMarksOnboardingCompleted() {
        UUID userId = UUID.randomUUID();
        User user = newUser(userId);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));

        var response = userService.completeOnboarding(userId, List.of());

        assertThat(response.personaTags()).isEmpty();
        assertThat(response.onboardingCompleted()).isTrue();
    }

    @Test
    void throwsWhenOnboardingAlreadyCompleted() {
        UUID userId = UUID.randomUUID();
        User user = newUser(userId);
        user.replacePersonaTags(new String[]{"K_FOOD_LOVER"});
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> userService.completeOnboarding(userId, List.of("CAFE_HOPPER")))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> {
                    BusinessException ex = (BusinessException) e;
                    assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.ONBOARDING_ALREADY_COMPLETED);
                });
    }
}

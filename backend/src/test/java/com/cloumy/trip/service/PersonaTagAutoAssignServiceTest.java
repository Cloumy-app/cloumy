package com.cloumy.trip.service;

import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.trip.repository.RouteRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PersonaTagAutoAssignServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private RouteRepository routeRepository;

    @InjectMocks
    private PersonaTagAutoAssignService personaTagAutoAssignService;

    private User newUser() {
        return User.builder()
                .oauthProvider("dev")
                .oauthId("test-user")
                .nickname("테스트 유저")
                .profileImageUrl(null)
                .build();
    }

    @Test
    void addsPersonaTagWhenThresholdReached() {
        UUID userId = UUID.randomUUID();
        User user = newUser();
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(routeRepository.countByUserIdAndThemesOverlap(any(), anyString()))
                .thenAnswer(inv -> "맛집".equals(inv.getArgument(1)) ? 3L : 0L);

        personaTagAutoAssignService.checkAndAssign(userId);

        assertThat(user.getPersonaTags()).contains("K_FOOD_LOVER");
    }

    @Test
    void doesNotAddPersonaTagWhenBelowThreshold() {
        UUID userId = UUID.randomUUID();
        User user = newUser();
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(routeRepository.countByUserIdAndThemesOverlap(any(), anyString())).thenReturn(2L);

        personaTagAutoAssignService.checkAndAssign(userId);

        assertThat(user.getPersonaTags()).isEmpty();
    }

    @Test
    void doesNotDuplicateAlreadyOwnedPersonaTag() {
        UUID userId = UUID.randomUUID();
        User user = newUser();
        user.replacePersonaTags(new String[]{"K_FOOD_LOVER"});
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(routeRepository.countByUserIdAndThemesOverlap(any(), anyString()))
                .thenAnswer(inv -> "맛집".equals(inv.getArgument(1)) ? 5L : 0L);

        personaTagAutoAssignService.checkAndAssign(userId);

        assertThat(user.getPersonaTags()).containsOnlyOnce("K_FOOD_LOVER");
    }
}

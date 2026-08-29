package com.cloumy.auth.service;

import com.cloumy.auth.dto.SocialLoginRequest;
import com.cloumy.auth.dto.SocialLoginResponse;
import com.cloumy.auth.entity.User;
import com.cloumy.auth.oauth.GoogleOAuthClient;
import com.cloumy.auth.oauth.KakaoOAuthClient;
import com.cloumy.auth.oauth.NaverOAuthClient;
import com.cloumy.auth.oauth.OAuthUserInfo;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.auth.security.JwtTokenProvider;
import com.cloumy.common.config.AppProperties;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private JwtTokenProvider tokenProvider;

    @Mock
    private AppProperties appProperties;

    @Mock
    private KakaoOAuthClient kakaoOAuthClient;

    @Mock
    private GoogleOAuthClient googleOAuthClient;

    @Mock
    private NaverOAuthClient naverOAuthClient;

    @InjectMocks
    private AuthService authService;

    private User existingUser(UUID userId, String provider, String oauthId) {
        User user = User.builder()
                .oauthProvider(provider)
                .oauthId(oauthId)
                .nickname("테스트 유저")
                .profileImageUrl(null)
                .build();
        ReflectionTestUtils.setField(user, "id", userId);
        return user;
    }

    @Test
    void appleProviderIsRejected() {
        // 보안 회귀 방지 — switch에서 apple 분기를 제거했다. 되살아나면 서명 미검증 취약점이 돌아온다.
        SocialLoginRequest request = new SocialLoginRequest("apple", "apple-oauth-token");

        assertThatThrownBy(() -> authService.processSocialLogin(request))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.INVALID_INPUT));
        verifyNoInteractions(kakaoOAuthClient, googleOAuthClient, naverOAuthClient);
    }

    @Test
    void unsupportedProviderIsRejected() {
        // apple 외에 화이트리스트에 없는 provider도 동일하게 거부돼야 한다
        SocialLoginRequest request = new SocialLoginRequest("facebook", "facebook-oauth-token");

        assertThatThrownBy(() -> authService.processSocialLogin(request))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.INVALID_INPUT));
        verifyNoInteractions(kakaoOAuthClient, googleOAuthClient, naverOAuthClient);
    }

    @Test
    void googleProviderDelegatesToGoogleOAuthClient() {
        // provider="google"이면 GoogleOAuthClient로 위임되고, 나머지 provider 클라이언트는 건드리지 않아야 한다
        UUID userId = UUID.randomUUID();
        SocialLoginRequest request = new SocialLoginRequest("google", "google-oauth-token");
        User user = existingUser(userId, "google", "google-id-1");

        when(googleOAuthClient.fetchUserInfo("google-oauth-token"))
                .thenReturn(new OAuthUserInfo("google-id-1", "구글 유저", "https://img.example.com/p.png"));
        when(userRepository.findByOauthProviderAndOauthId("google", "google-id-1"))
                .thenReturn(Optional.of(user));
        when(tokenProvider.generateAccessToken(anyString(), anyString())).thenReturn("access-token");
        when(tokenProvider.generateRefreshToken(anyString())).thenReturn("refresh-token");
        when(appProperties.getJwt()).thenReturn(new AppProperties.Jwt("secret", 3600L, 604800L));

        SocialLoginResponse response = authService.processSocialLogin(request);

        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.refreshToken()).isEqualTo("refresh-token");
        verify(googleOAuthClient).fetchUserInfo("google-oauth-token");
        verifyNoInteractions(kakaoOAuthClient, naverOAuthClient);
    }

    @Test
    void providerMatchingIsCaseInsensitive() {
        // toLowerCase() 적용 확인 — "GOOGLE"도 google 분기로 들어가야 한다
        UUID userId = UUID.randomUUID();
        SocialLoginRequest request = new SocialLoginRequest("GOOGLE", "google-oauth-token");
        User user = existingUser(userId, "google", "google-id-1");

        when(googleOAuthClient.fetchUserInfo("google-oauth-token"))
                .thenReturn(new OAuthUserInfo("google-id-1", "구글 유저", null));
        when(userRepository.findByOauthProviderAndOauthId("GOOGLE", "google-id-1"))
                .thenReturn(Optional.of(user));
        when(tokenProvider.generateAccessToken(anyString(), anyString())).thenReturn("access-token");
        when(tokenProvider.generateRefreshToken(anyString())).thenReturn("refresh-token");
        when(appProperties.getJwt()).thenReturn(new AppProperties.Jwt("secret", 3600L, 604800L));

        authService.processSocialLogin(request);

        verify(googleOAuthClient).fetchUserInfo("google-oauth-token");
        verify(kakaoOAuthClient, never()).fetchUserInfo(anyString());
        verify(naverOAuthClient, never()).fetchUserInfo(anyString());
    }
}

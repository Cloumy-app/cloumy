package com.cloumy.auth.service;

import com.cloumy.auth.dto.LogoutRequest;
import com.cloumy.auth.dto.RefreshRequest;
import com.cloumy.auth.dto.SocialLoginRequest;
import com.cloumy.auth.dto.SocialLoginResponse;
import com.cloumy.auth.entity.User;
import com.cloumy.auth.oauth.*;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.auth.security.JwtTokenProvider;
import com.cloumy.common.config.AppProperties;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final JwtTokenProvider tokenProvider;
    private final AppProperties appProperties;

    private final KakaoOAuthClient kakaoOAuthClient;
    private final GoogleOAuthClient googleOAuthClient;
    private final AppleOAuthClient appleOAuthClient;
    private final NaverOAuthClient naverOAuthClient;

    @Transactional
    public SocialLoginResponse processSocialLogin(SocialLoginRequest request) {
        OAuthUserInfo userInfo = fetchOAuthUserInfo(request.provider(), request.oauthAccessToken());

        User user = userRepository
                .findByOauthProviderAndOauthId(request.provider(), userInfo.oauthId())
                .map(existing -> {
                    existing.updateProfile(userInfo.nickname(), userInfo.profileImageUrl());
                    return existing;
                })
                .orElseGet(() -> {
                    User newUser = User.builder()
                            .oauthProvider(request.provider())
                            .oauthId(userInfo.oauthId())
                            .nickname(userInfo.nickname())
                            .profileImageUrl(userInfo.profileImageUrl())
                            .build();
                    newUser.grantDayPass();
                    return newUser;
                });

        userRepository.save(user);

        String userId = user.getId().toString();
        String accessToken = tokenProvider.generateAccessToken(userId, "USER");
        String refreshToken = tokenProvider.generateRefreshToken(userId);
        long expiresIn = appProperties.getJwt().accessTtl();

        return new SocialLoginResponse(
                accessToken,
                refreshToken,
                "Bearer",
                expiresIn,
                new SocialLoginResponse.UserInfo(userId, user.getNickname(), user.getProfileImageUrl())
        );
    }

    public Map<String, String> refreshAccessToken(RefreshRequest request) {
        Claims claims = tokenProvider.validateToken(request.refreshToken());

        // access token으로 갱신 시도하는 경우 차단
        if (!"refresh".equals(claims.get("type", String.class))) {
            throw new BusinessException(ErrorCode.JWT_INVALID);
        }

        String userId = tokenProvider.extractUserId(claims);
        userRepository.findById(UUID.fromString(userId))
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        String newAccessToken = tokenProvider.generateAccessToken(userId, "USER");
        return Map.of("accessToken", newAccessToken);
    }

    public void logout(LogoutRequest request) {
        Claims claims = tokenProvider.validateToken(request.refreshToken());
        tokenProvider.revokeToken(claims);
    }

    private OAuthUserInfo fetchOAuthUserInfo(String provider, String oauthToken) {
        return switch (provider.toLowerCase()) {
            case "kakao"  -> kakaoOAuthClient.fetchUserInfo(oauthToken);
            case "google" -> googleOAuthClient.fetchUserInfo(oauthToken);
            case "apple"  -> appleOAuthClient.fetchUserInfo(oauthToken);
            case "naver"  -> naverOAuthClient.fetchUserInfo(oauthToken);
            default -> throw new BusinessException(ErrorCode.INVALID_INPUT, "지원하지 않는 소셜 로그인입니다: " + provider);
        };
    }
}

package com.cloumy.auth.controller;

import com.cloumy.auth.dto.SocialLoginResponse;
import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.auth.security.JwtTokenProvider;
import com.cloumy.common.config.AppProperties;
import com.cloumy.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// dev 프로필에서만 활성화 — prod 배포 시 이 빈은 생성되지 않음
@Profile("dev")
@RestController
@RequestMapping("/v1/dev")
@RequiredArgsConstructor
public class DevAuthController {

    private static final String DEV_PROVIDER = "dev";
    private static final String DEV_OAUTH_ID = "test-user-1";

    private final UserRepository userRepository;
    private final JwtTokenProvider tokenProvider;
    private final AppProperties appProperties;

    @PostMapping("/token")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<SocialLoginResponse> issueDevToken() {
        User user = userRepository
                .findByOauthProviderAndOauthId(DEV_PROVIDER, DEV_OAUTH_ID)
                .orElseGet(() -> {
                    User newUser = User.builder()
                            .oauthProvider(DEV_PROVIDER)
                            .oauthId(DEV_OAUTH_ID)
                            .nickname("테스트 유저")
                            .profileImageUrl(null)
                            .build();
                    return userRepository.save(newUser);
                });
        // 매 dev 로그인마다 패스 갱신 — 만료 걱정 없이 테스트 가능
        user.grantDayPass();

        String userId = user.getId().toString();
        String accessToken = tokenProvider.generateAccessToken(userId, "USER");
        String refreshToken = tokenProvider.generateRefreshToken(userId);
        long expiresIn = appProperties.getJwt().accessTtl();

        return ApiResponse.ok(new SocialLoginResponse(
                accessToken,
                refreshToken,
                "Bearer",
                expiresIn,
                new SocialLoginResponse.UserInfo(userId, user.getNickname(), user.getProfileImageUrl())
        ));
    }
}

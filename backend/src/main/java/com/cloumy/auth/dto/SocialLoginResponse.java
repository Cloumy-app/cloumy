package com.cloumy.auth.dto;

public record SocialLoginResponse(
        String accessToken,
        String refreshToken,
        String tokenType,
        long expiresIn,
        UserInfo user
) {
    public record UserInfo(
            String id,
            String nickname,
            String profileImageUrl
    ) {}
}

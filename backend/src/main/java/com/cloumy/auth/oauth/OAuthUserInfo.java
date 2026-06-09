package com.cloumy.auth.oauth;

public record OAuthUserInfo(
        String oauthId,
        String nickname,
        String profileImageUrl  // 애플은 null
) {}

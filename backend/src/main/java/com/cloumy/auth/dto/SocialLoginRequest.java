package com.cloumy.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record SocialLoginRequest(
        @NotBlank String provider,           // "kakao" | "google" | "apple" | "naver"
        @NotBlank String oauthAccessToken    // 애플은 identity token(JWT) 전달
) {}

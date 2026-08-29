package com.cloumy.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record SocialLoginRequest(
        @NotBlank String provider,           // "kakao" | "google" | "naver"
        @NotBlank String oauthAccessToken
) {}

package com.cloumy.common.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    @Valid
    private final Jwt jwt;

    @Valid
    private final OAuth oauth;

    public AppProperties(Jwt jwt, OAuth oauth) {
        this.jwt = jwt;
        this.oauth = oauth;
    }

    public Jwt getJwt() { return jwt; }
    public OAuth getOauth() { return oauth; }

    // --- JWT ---

    public record Jwt(
            @NotBlank String secret,
            @Positive long accessTtl,
            @Positive long refreshTtl
    ) {}

    // --- OAuth ---

    public record OAuth(
            OAuthProvider kakao,
            OAuthProvider google,
            Apple apple,
            OAuthProvider naver
    ) {}

    // 카카오, 구글, 네이버 공통 (clientId + clientSecret + redirectUri)
    public record OAuthProvider(
            String clientId,
            String clientSecret,
            String redirectUri
    ) {}

    // 애플은 client-secret 대신 p8 키 기반 서명 방식 사용
    public record Apple(
            String clientId,
            String teamId,
            String keyId,
            String privateKey
    ) {}
}

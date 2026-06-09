package com.cloumy.auth.oauth;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class AppleOAuthClient {

    private final ObjectMapper objectMapper;

    // 애플은 OAuth access token 대신 identity token(JWT)을 받음
    // 서명 검증 없이 payload만 파싱 — 프로덕션에서는 Apple 공개키로 서명 검증 필요
    public OAuthUserInfo fetchUserInfo(String identityToken) {
        String[] parts = identityToken.split("\\.");
        if (parts.length != 3) {
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        Map<String, Object> claims;
        try {
            byte[] payloadBytes = Base64.getUrlDecoder().decode(parts[1]);
            claims = objectMapper.readValue(payloadBytes, new TypeReference<>() {});
        } catch (Exception e) {
            log.error("애플 identity token 파싱 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        String sub = (String) claims.get("sub");
        String email = (String) claims.get("email");

        if (sub == null) {
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        // 애플은 최초 1회만 이름 제공하고 이후 null → email 앞부분으로 임시 닉네임 생성
        String nickname = email != null ? email.split("@")[0] : "애플유저";

        return new OAuthUserInfo(sub, nickname, null);
    }
}

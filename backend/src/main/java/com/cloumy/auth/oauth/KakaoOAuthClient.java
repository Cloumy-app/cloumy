package com.cloumy.auth.oauth;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Slf4j
@Component
public class KakaoOAuthClient {

    private RestClient restClient;

    @PostConstruct
    public void init() {
        restClient = RestClient.builder()
                .baseUrl("https://kapi.kakao.com")
                .build();
    }

    public OAuthUserInfo fetchUserInfo(String oauthToken) {
        KakaoUserResponse response;
        try {
            response = restClient.get()
                    .uri("/v2/user/me")
                    .header("Authorization", "Bearer " + oauthToken)
                    .retrieve()
                    .body(KakaoUserResponse.class);
        } catch (RestClientException e) {
            log.error("카카오 사용자 정보 조회 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        if (response == null || response.id() == null) {
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        String nickname = response.kakaoAccount() != null
                && response.kakaoAccount().profile() != null
                ? response.kakaoAccount().profile().nickname()
                : "카카오유저";

        String profileImageUrl = response.kakaoAccount() != null
                && response.kakaoAccount().profile() != null
                ? response.kakaoAccount().profile().profileImageUrl()
                : null;

        return new OAuthUserInfo(String.valueOf(response.id()), nickname, profileImageUrl);
    }

    private record KakaoUserResponse(
            Long id,
            @JsonProperty("kakao_account") KakaoAccount kakaoAccount
    ) {}

    private record KakaoAccount(
            KakaoProfile profile
    ) {}

    private record KakaoProfile(
            String nickname,
            @JsonProperty("profile_image_url") String profileImageUrl
    ) {}
}

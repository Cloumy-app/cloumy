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
public class NaverOAuthClient {

    private RestClient restClient;

    @PostConstruct
    public void init() {
        restClient = RestClient.builder()
                .baseUrl("https://openapi.naver.com")
                .build();
    }

    public OAuthUserInfo fetchUserInfo(String oauthToken) {
        NaverUserResponse response;
        try {
            response = restClient.get()
                    .uri("/v1/nid/me")
                    .header("Authorization", "Bearer " + oauthToken)
                    .retrieve()
                    .body(NaverUserResponse.class);
        } catch (RestClientException e) {
            log.error("네이버 사용자 정보 조회 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        if (response == null || response.profile() == null || response.profile().id() == null) {
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        NaverProfile profile = response.profile();
        return new OAuthUserInfo(profile.id(), profile.nickname(), profile.profileImage());
    }

    private record NaverUserResponse(
            @JsonProperty("response") NaverProfile profile
    ) {}

    private record NaverProfile(
            String id,
            String nickname,
            @JsonProperty("profile_image") String profileImage
    ) {}
}

package com.cloumy.auth.oauth;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Slf4j
@Component
public class GoogleOAuthClient {

    private RestClient restClient;

    @PostConstruct
    public void init() {
        restClient = RestClient.builder()
                .baseUrl("https://www.googleapis.com")
                .build();
    }

    public OAuthUserInfo fetchUserInfo(String oauthToken) {
        GoogleUserResponse response;
        try {
            response = restClient.get()
                    .uri("/oauth2/v2/userinfo")
                    .header("Authorization", "Bearer " + oauthToken)
                    .retrieve()
                    .body(GoogleUserResponse.class);
        } catch (RestClientException e) {
            log.error("구글 사용자 정보 조회 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        if (response == null || response.id() == null) {
            throw new BusinessException(ErrorCode.OAUTH_USER_INFO_FAILED);
        }

        return new OAuthUserInfo(response.id(), response.name(), response.picture());
    }

    private record GoogleUserResponse(
            String id,
            String name,
            String picture
    ) {}
}

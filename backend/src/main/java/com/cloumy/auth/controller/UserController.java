package com.cloumy.auth.controller;

import com.cloumy.auth.dto.PersonaTagsRequest;
import com.cloumy.auth.dto.UserProfileResponse;
import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.auth.service.UserService;
import com.cloumy.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/v1/users/me")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @GetMapping
    public ApiResponse<UserProfileResponse> getMe(@AuthenticationPrincipal CloudmyUserDetails user) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(userService.getProfile(userId));
    }

    // 온보딩 최초 1회만 호출 가능 — 이후엔 ONBOARDING_ALREADY_COMPLETED(409).
    // 페르소나 태그는 이후 자동추가(PersonaTagAutoAssignService)로만 갱신되고 유저가 직접 편집할 수 없다.
    @PostMapping("/onboarding")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<UserProfileResponse> completeOnboarding(
            @RequestBody @Valid PersonaTagsRequest request,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(userService.completeOnboarding(userId, request.tags()));
    }
}

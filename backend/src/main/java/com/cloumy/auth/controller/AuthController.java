package com.cloumy.auth.controller;

import com.cloumy.auth.dto.LogoutRequest;
import com.cloumy.auth.dto.RefreshRequest;
import com.cloumy.auth.dto.SocialLoginRequest;
import com.cloumy.auth.dto.SocialLoginResponse;
import com.cloumy.auth.service.AuthService;
import com.cloumy.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/social")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<SocialLoginResponse> socialLogin(
            @RequestBody @Valid SocialLoginRequest request
    ) {
        return ApiResponse.ok(authService.processSocialLogin(request));
    }

    @PostMapping("/refresh")
    public ApiResponse<Map<String, String>> refresh(
            @RequestBody @Valid RefreshRequest request
    ) {
        return ApiResponse.ok(authService.refreshAccessToken(request));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(
            @RequestBody @Valid LogoutRequest request
    ) {
        authService.logout(request);
        return ApiResponse.ok();
    }
}

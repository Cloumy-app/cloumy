package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.AccommodationCreateRequest;
import com.cloumy.trip.dto.AccommodationResponse;
import com.cloumy.trip.dto.KakaoPlaceDto;
import com.cloumy.trip.service.AccommodationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class AccommodationController {

    private final AccommodationService accommodationService;

    // 검색 결과만 반환 — 저장은 create()에서 사용자가 고른 뒤에 이뤄짐
    @GetMapping("/accommodations/search")
    public ApiResponse<List<KakaoPlaceDto>> search(@RequestParam String keyword) {
        return ApiResponse.ok(accommodationService.search(keyword));
    }

    @PostMapping("/routes/{routeId}/accommodations")
    public ApiResponse<AccommodationResponse> create(
            @PathVariable UUID routeId,
            @RequestBody @Valid AccommodationCreateRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(accommodationService.create(routeId, userId, req));
    }

    @GetMapping("/routes/{routeId}/accommodations")
    public ApiResponse<List<AccommodationResponse>> list(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(accommodationService.getByRoute(routeId, userId));
    }

    @DeleteMapping("/routes/{routeId}/accommodations/{accommodationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable UUID routeId,
            @PathVariable UUID accommodationId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        UUID userId = UUID.fromString(user.userId());
        accommodationService.delete(routeId, accommodationId, userId);
    }
}

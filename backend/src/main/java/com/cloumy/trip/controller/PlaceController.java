package com.cloumy.trip.controller;

import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.ExternalPlaceRequest;
import com.cloumy.trip.dto.ExternalPlaceResponse;
import com.cloumy.trip.dto.PlaceDetailResponse;
import com.cloumy.trip.service.PlaceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/v1/places")
@RequiredArgsConstructor
public class PlaceController {

    private final PlaceService placeService;

    @GetMapping("/{placeId}")
    public ApiResponse<PlaceDetailResponse> getPlaceDetail(@PathVariable UUID placeId) {
        return ApiResponse.ok(placeService.getPlaceDetail(placeId));
    }

    // 외부/수동 장소 find-or-create — 콘서트 검색 결과, 카카오 라이브 검색 결과, 유저 직접 입력이
    // 공통으로 호출. 인증은 SecurityConfig의 anyRequest().authenticated()로 강제되므로
    // 컨트롤러에서 별도로 principal을 받아 쓸 필요는 없다.
    @PostMapping("/external")
    public ApiResponse<ExternalPlaceResponse> resolveExternalPlace(
            @RequestBody @Valid ExternalPlaceRequest req
    ) {
        UUID placeId = placeService.resolveExternalPlace(req);
        return ApiResponse.ok(new ExternalPlaceResponse(placeId));
    }
}

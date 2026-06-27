package com.cloumy.trip.controller;

import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.PlaceDetailResponse;
import com.cloumy.trip.service.PlaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
}

package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.InsertSlotRequest;
import com.cloumy.trip.dto.ReplaceSlotRequest;
import com.cloumy.trip.dto.SlotAlternativeResponse;
import com.cloumy.trip.dto.SlotResponse;
import com.cloumy.trip.service.RouteSlotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/routes/{routeId}/slots")
@RequiredArgsConstructor
public class RouteSlotController {

    private final RouteSlotService routeSlotService;

    @GetMapping
    public ApiResponse<List<SlotResponse>> getSlots(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(routeSlotService.getSlots(routeId, UUID.fromString(user.userId())));
    }

    @PatchMapping("/{slotId}/pin")
    public ApiResponse<SlotResponse> togglePin(
            @PathVariable UUID routeId,
            @PathVariable UUID slotId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(routeSlotService.togglePin(routeId, slotId, UUID.fromString(user.userId())));
    }

    @DeleteMapping("/{slotId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSlot(
            @PathVariable UUID routeId,
            @PathVariable UUID slotId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        routeSlotService.deleteSlot(routeId, slotId, UUID.fromString(user.userId()));
    }

    @PostMapping("/{slotId}/alternatives")
    public ApiResponse<List<SlotAlternativeResponse>> getAlternatives(
            @PathVariable UUID routeId,
            @PathVariable UUID slotId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(
                routeSlotService.getAlternatives(routeId, slotId, UUID.fromString(user.userId())));
    }

    @PostMapping
    public ApiResponse<List<SlotResponse>> insertSlot(
            @PathVariable UUID routeId,
            @RequestBody @Valid InsertSlotRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(routeSlotService.insertSlotAfter(
                routeId, UUID.fromString(user.userId()), req.afterSlotId(), req.placeId(), req.reason()));
    }

    @PatchMapping("/{slotId}")
    public ApiResponse<List<SlotResponse>> replaceSlot(
            @PathVariable UUID routeId,
            @PathVariable UUID slotId,
            @RequestBody @Valid ReplaceSlotRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(
                routeSlotService.replaceSlot(routeId, slotId, UUID.fromString(user.userId()), req));
    }
}

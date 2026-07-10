package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.PlaceBrowseResponse;
import com.cloumy.trip.service.ExploreService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1")
@RequiredArgsConstructor
public class ExploreController {

    private final ExploreService exploreService;

    // 정렬은 네이티브 쿼리의 ORDER BY(review_count DESC)가 유일한 기준 — Pageable의 sort는
    // 페이지 번호·사이즈에만 쓰이고 무시된다(derived query가 아니라서).
    @GetMapping("/places/browse")
    public ApiResponse<Page<PlaceBrowseResponse>> browse(
            @RequestParam String city,
            @RequestParam(required = false) List<String> tags,
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 50) Pageable pageable
    ) {
        UUID userId = UUID.fromString(user.userId());
        return ApiResponse.ok(exploreService.browsePlaces(city, tags, userId, pageable));
    }

    @PostMapping("/places/{placeId}/bookmark")
    public ApiResponse<Void> addBookmark(
            @PathVariable UUID placeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        exploreService.addBookmark(UUID.fromString(user.userId()), placeId);
        return ApiResponse.ok();
    }

    @DeleteMapping("/places/{placeId}/bookmark")
    public ApiResponse<Void> removeBookmark(
            @PathVariable UUID placeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        exploreService.removeBookmark(UUID.fromString(user.userId()), placeId);
        return ApiResponse.ok();
    }

    @GetMapping("/bookmarks")
    public ApiResponse<Page<PlaceBrowseResponse>> myBookmarks(
            @AuthenticationPrincipal CloudmyUserDetails user,
            @PageableDefault(size = 50) Pageable pageable
    ) {
        return ApiResponse.ok(exploreService.getMyBookmarks(UUID.fromString(user.userId()), pageable));
    }
}

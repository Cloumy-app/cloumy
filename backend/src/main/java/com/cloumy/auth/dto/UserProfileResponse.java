package com.cloumy.auth.dto;

import java.util.List;

public record UserProfileResponse(
        String id,
        String nickname,
        String profileImageUrl,
        List<String> personaTags,
        boolean onboardingCompleted
) {}

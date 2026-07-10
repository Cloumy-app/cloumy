package com.cloumy.auth.service;

import com.cloumy.auth.constant.PersonaTag;
import com.cloumy.auth.dto.UserProfileResponse;
import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    public UserProfileResponse getProfile(UUID userId) {
        return toResponse(getUser(userId));
    }

    // 페르소나 태그는 "칭호" 개념 — 온보딩(최초 1회)과 자동추가(routes.tags 누적, PersonaTagAutoAssignService)로만
    // 부여되고, 유저가 자의로 추가·삭제할 수 없다. 그래서 이 메서드는 온보딩 완료 전에만 호출 가능하다.
    @Transactional
    public UserProfileResponse completeOnboarding(UUID userId, List<String> tags) {
        validateTags(tags);
        User user = getUser(userId);
        if (user.getOnboardingCompletedAt() != null) {
            throw new BusinessException(ErrorCode.ONBOARDING_ALREADY_COMPLETED);
        }
        user.replacePersonaTags(tags.toArray(new String[0]));
        return toResponse(user);
    }

    private void validateTags(List<String> tags) {
        for (String tag : tags) {
            try {
                PersonaTag.valueOf(tag);
            } catch (IllegalArgumentException e) {
                throw new BusinessException(ErrorCode.INVALID_PERSONA_TAG);
            }
        }
    }

    private User getUser(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    private UserProfileResponse toResponse(User user) {
        return new UserProfileResponse(
                user.getId().toString(),
                user.getNickname(),
                user.getProfileImageUrl(),
                List.of(user.getPersonaTags()),
                user.getOnboardingCompletedAt() != null
        );
    }
}

package com.cloumy.trip.service;

import com.cloumy.auth.constant.PersonaTag;
import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class PersonaTagAutoAssignService {

    private static final int THRESHOLD = 3;

    // 장소 성향 태그(frontend/app/route/create/step-2.tsx의 THEMES) → 페르소나
    // K_POP_PILGRIM/K_DRAMA_FAN/K_BEAUTY_ADDICT/CONTENT_CREATOR: 매핑 없음(온보딩·수동 편집 전용)
    private static final Map<PersonaTag, List<String>> PERSONA_THEMES = Map.of(
            PersonaTag.K_FOOD_LOVER, List.of("맛집"),
            PersonaTag.CAFE_HOPPER, List.of("카페"),
            PersonaTag.NATURE_SEEKER, List.of("자연"),
            PersonaTag.SHOPPING_MAVEN, List.of("쇼핑"),
            PersonaTag.CULTURE_EXPLORER, List.of("문화", "관광"),
            PersonaTag.NIGHT_OWL, List.of("야경")
    );

    private final UserRepository userRepository;
    private final RouteRepository routeRepository;

    @Transactional
    public void checkAndAssign(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        List<String> owned = Arrays.asList(user.getPersonaTags());

        for (Map.Entry<PersonaTag, List<String>> entry : PERSONA_THEMES.entrySet()) {
            String personaName = entry.getKey().name();
            if (owned.contains(personaName)) {
                continue;
            }
            String themesCsv = String.join(",", entry.getValue());
            long count = routeRepository.countByUserIdAndThemesOverlap(userId, themesCsv);
            if (count >= THRESHOLD) {
                user.addPersonaTagIfAbsent(personaName);
            }
        }
    }
}

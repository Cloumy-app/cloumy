package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.BudgetSummaryResponse;
import com.cloumy.trip.dto.UpdateRatiosRequest;
import com.cloumy.trip.entity.BudgetSettings;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.BudgetSettingsRepository;
import com.cloumy.trip.repository.ExpenseRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class BudgetSettingsService {

    // 숙박 제외 후 재정규화된 기본 비율(DB 기본값 food 0.30/transport 0.20/activity 0.10/etc 0.05 =
    // 합 0.65를 0.65로 나눈 값) — accommodation_ratio(0.35)는 이번 단계 스코프 밖이라 반영 안 함
    private static final double DEFAULT_FOOD = 0.30 / 0.65;
    private static final double DEFAULT_TRANSPORT = 0.20 / 0.65;
    private static final double DEFAULT_ACTIVITY = 0.10 / 0.65;
    private static final double DEFAULT_ETC = 0.05 / 0.65;

    // 장소 성향 태그(frontend/app/route/create/step-2.tsx의 THEMES) → 카테고리 boost
    private static final Map<String, Boost> TAG_BOOSTS = Map.of(
            "맛집", new Boost(Category.FOOD, 0.08),
            "카페", new Boost(Category.FOOD, 0.04),
            "관광", new Boost(Category.ACTIVITY, 0.05),
            "문화", new Boost(Category.ACTIVITY, 0.05),
            "액티비티", new Boost(Category.ACTIVITY, 0.08),
            "쇼핑", new Boost(Category.ETC, 0.05)
            // 자연/힐링/야경은 매핑 없음 — 조정 안 함
    );

    private static final double MAX_BOOST_PER_CATEGORY = 0.10;
    private static final double MIN_RATIO = 0.05;
    private static final double RATIO_SUM_EPSILON = 0.001;

    private enum Category { FOOD, TRANSPORT, ACTIVITY, ETC }

    private record Boost(Category category, double amount) {}

    private record RatioSet(double food, double transport, double activity, double etc) {}

    private final RouteRepository routeRepository;
    private final BudgetSettingsRepository budgetSettingsRepository;
    private final RouteSlotRepository routeSlotRepository;
    private final ExpenseRepository expenseRepository;

    @Transactional
    public void createDefault(UUID routeId, int totalBudget, List<String> tags) {
        RatioSet ratios = computeDefaultRatios(tags == null ? List.of() : tags);
        BudgetSettings settings = BudgetSettings.builder()
                .routeId(routeId)
                .totalBudget(totalBudget)
                .foodRatio(ratios.food())
                .transportRatio(ratios.transport())
                .activityRatio(ratios.activity())
                .etcRatio(ratios.etc())
                .build();
        budgetSettingsRepository.save(settings);
    }

    public BudgetSummaryResponse getSummary(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        Optional<BudgetSettings> settings = budgetSettingsRepository.findByRouteId(routeId);

        int plannedTotal = routeSlotRepository.sumEstimatedCostByRouteId(routeId);
        int unplannedTotal = expenseRepository.sumActualAmountByRouteId(routeId);

        if (settings.isEmpty()) {
            return new BudgetSummaryResponse(null, null, null, null, null, plannedTotal, unplannedTotal, null);
        }

        BudgetSettings s = settings.get();
        int remaining = s.getTotalBudget() - plannedTotal - unplannedTotal;
        return new BudgetSummaryResponse(
                s.getTotalBudget(), s.getFoodRatio(), s.getTransportRatio(), s.getActivityRatio(), s.getEtcRatio(),
                plannedTotal, unplannedTotal, remaining);
    }

    @Transactional
    public BudgetSummaryResponse updateRatios(UUID routeId, UUID userId, UpdateRatiosRequest req) {
        verifyOwner(routeId, userId);
        BudgetSettings settings = budgetSettingsRepository.findByRouteId(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.BUDGET_SETTINGS_NOT_FOUND));

        double sum = req.foodRatio() + req.transportRatio() + req.activityRatio() + req.etcRatio();
        if (Math.abs(sum - 1.0) > RATIO_SUM_EPSILON) {
            throw new BusinessException(ErrorCode.INVALID_BUDGET_RATIO);
        }

        settings.updateRatios(req.foodRatio(), req.transportRatio(), req.activityRatio(), req.etcRatio());
        return getSummary(routeId, userId);
    }

    // 순수 함수 — 유닛 테스트하기 쉽도록 스프링 빈 상태에 의존하지 않음
    private RatioSet computeDefaultRatios(List<String> tags) {
        double foodBoost = 0, transportBoost = 0, activityBoost = 0, etcBoost = 0;
        for (String tag : tags) {
            Boost boost = TAG_BOOSTS.get(tag);
            if (boost == null) {
                continue;
            }
            switch (boost.category()) {
                case FOOD -> foodBoost = Math.min(MAX_BOOST_PER_CATEGORY, foodBoost + boost.amount());
                case TRANSPORT -> transportBoost = Math.min(MAX_BOOST_PER_CATEGORY, transportBoost + boost.amount());
                case ACTIVITY -> activityBoost = Math.min(MAX_BOOST_PER_CATEGORY, activityBoost + boost.amount());
                case ETC -> etcBoost = Math.min(MAX_BOOST_PER_CATEGORY, etcBoost + boost.amount());
            }
        }

        double totalBoost = foodBoost + transportBoost + activityBoost + etcBoost;
        if (totalBoost == 0) {
            return new RatioSet(DEFAULT_FOOD, DEFAULT_TRANSPORT, DEFAULT_ACTIVITY, DEFAULT_ETC);
        }

        // boost 안 받은 카테고리들의 기본 비중 합 — 여기서 boost 총량만큼 비례 차감
        double food = DEFAULT_FOOD, transport = DEFAULT_TRANSPORT, activity = DEFAULT_ACTIVITY, etc = DEFAULT_ETC;
        double nonBoostedBase = 0;
        if (foodBoost == 0) {
            nonBoostedBase += DEFAULT_FOOD;
        }
        if (transportBoost == 0) {
            nonBoostedBase += DEFAULT_TRANSPORT;
        }
        if (activityBoost == 0) {
            nonBoostedBase += DEFAULT_ACTIVITY;
        }
        if (etcBoost == 0) {
            nonBoostedBase += DEFAULT_ETC;
        }

        // transport는 태그 매핑이 없어 항상 차감 후보로 남으므로 nonBoostedBase는 0이 될 수 없음
        if (foodBoost == 0) {
            food -= totalBoost * (DEFAULT_FOOD / nonBoostedBase);
        }
        if (transportBoost == 0) {
            transport -= totalBoost * (DEFAULT_TRANSPORT / nonBoostedBase);
        }
        if (activityBoost == 0) {
            activity -= totalBoost * (DEFAULT_ACTIVITY / nonBoostedBase);
        }
        if (etcBoost == 0) {
            etc -= totalBoost * (DEFAULT_ETC / nonBoostedBase);
        }

        food += foodBoost;
        transport += transportBoost;
        activity += activityBoost;
        etc += etcBoost;

        return applyMinGuardAndNormalize(food, transport, activity, etc);
    }

    // 극단적 조합에서 특정 카테고리가 0.05 밑으로 내려가면 가장 큰 카테고리에서 보충
    private RatioSet applyMinGuardAndNormalize(double food, double transport, double activity, double etc) {
        double[] values = {food, transport, activity, etc};
        for (int i = 0; i < values.length; i++) {
            if (values[i] < MIN_RATIO) {
                double deficit = MIN_RATIO - values[i];
                int maxIdx = 0;
                for (int j = 1; j < values.length; j++) {
                    if (values[j] > values[maxIdx]) {
                        maxIdx = j;
                    }
                }
                values[i] = MIN_RATIO;
                values[maxIdx] -= deficit;
            }
        }

        // 반올림 오차 보정 — 가장 큰 카테고리에 나머지를 더함
        double sum = values[0] + values[1] + values[2] + values[3];
        double diff = 1.0 - sum;
        int maxIdx = 0;
        for (int j = 1; j < values.length; j++) {
            if (values[j] > values[maxIdx]) {
                maxIdx = j;
            }
        }
        values[maxIdx] += diff;

        return new RatioSet(values[0], values[1], values[2], values[3]);
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

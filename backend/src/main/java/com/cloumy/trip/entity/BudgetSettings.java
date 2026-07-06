package com.cloumy.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "budget_settings")
public class BudgetSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "route_id", nullable = false, unique = true)
    private UUID routeId;

    @Column(name = "total_budget", nullable = false)
    private int totalBudget;

    // 숙박은 이번 단계 스코프 밖(accommodations에 비용 데이터 자체가 없음) — 항상 0.0 저장.
    // 컬럼 자체는 NOT NULL이라 스키마를 안 건드리기 위해 0.0으로 채운다.
    @Column(name = "accommodation_ratio", nullable = false)
    private double accommodationRatio;

    @Column(name = "food_ratio", nullable = false)
    private double foodRatio;

    @Column(name = "transport_ratio", nullable = false)
    private double transportRatio;

    @Column(name = "activity_ratio", nullable = false)
    private double activityRatio; // = 입장료

    @Column(name = "etc_ratio", nullable = false)
    private double etcRatio;

    @Builder
    private BudgetSettings(UUID routeId, int totalBudget,
                           double foodRatio, double transportRatio,
                           double activityRatio, double etcRatio) {
        this.routeId = routeId;
        this.totalBudget = totalBudget;
        this.accommodationRatio = 0.0;
        this.foodRatio = foodRatio;
        this.transportRatio = transportRatio;
        this.activityRatio = activityRatio;
        this.etcRatio = etcRatio;
    }

    // 슬라이더로 사용자가 직접 비율 조정(합 1.0 검증은 서비스 레이어에서)
    public void updateRatios(double foodRatio, double transportRatio, double activityRatio, double etcRatio) {
        this.foodRatio = foodRatio;
        this.transportRatio = transportRatio;
        this.activityRatio = activityRatio;
        this.etcRatio = etcRatio;
    }
}

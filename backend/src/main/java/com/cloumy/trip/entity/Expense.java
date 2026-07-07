package com.cloumy.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;
import java.util.UUID;

// 이번 스코프에서는 비계획 지출(unplanned) 전용 — 계획 지출은 route_slots.estimated_cost를
// 매번 집계해서 쓰고 별도 레코드를 만들지 않는다(설계 근거는 planning/milestones.md 참고).
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@EntityListeners(AuditingEntityListener.class)
@Entity
@Table(name = "expenses")
public class Expense {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "route_id", nullable = false)
    private UUID routeId;

    @Column(name = "slot_id")
    private UUID slotId; // 항상 null(비계획 지출 전용)

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "expense_type", nullable = false)
    private String expenseType; // 항상 "unplanned"

    @Column(nullable = false)
    private String category; // FOOD/TRANSPORT/ADMISSION/SOUVENIR/ETC (ACCOMMODATION 제외)

    @Column(name = "planned_amount")
    private Integer plannedAmount; // 항상 null

    @Column(name = "actual_amount", nullable = false)
    private int actualAmount;

    private String memo;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Builder
    private Expense(UUID routeId, UUID userId, String category, int actualAmount, String memo) {
        this.routeId = routeId;
        this.userId = userId;
        this.slotId = null;
        this.expenseType = "unplanned";
        this.category = category;
        this.plannedAmount = null;
        this.actualAmount = actualAmount;
        this.memo = memo;
    }
}

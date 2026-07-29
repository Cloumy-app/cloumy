package com.cloumy.trip.entity;

import com.cloumy.common.entity.BaseEntity;
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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "routes")
public class Route extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String destination;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Column(nullable = false)
    private int nights;

    @Column(name = "group_type", nullable = false)
    private String groupType;

    @Column(name = "budget_level", nullable = false)
    private String budgetLevel;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]")
    private String[] tags = {};

    @Column(nullable = true)
    private String density;

    @Column(name = "is_public", nullable = false)
    private boolean isPublic = false;

    @Column(name = "save_count", nullable = false)
    private int saveCount = 0;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    // 가는 편 출발 일시(선택 입력) — 프로액티브 T1(출국 준비) 알림의 기준값. 미입력이 기본(V19)
    // DB(TIMESTAMPTZ)·프론트(UTC ISO)와 시간대 정보를 맞추기 위해 OffsetDateTime을 쓴다.
    @Column(name = "departure_at")
    private OffsetDateTime departureAt;

    // 오는 편 출발 일시(선택 입력) — RETURN_DEPARTURE 규칙의 기준값. departure_at과 대칭(V20)
    @Column(name = "return_at")
    private OffsetDateTime returnAt;

    @Builder
    private Route(UUID userId, String title, String destination,
                  LocalDate startDate, LocalDate endDate, int nights,
                  String groupType, String budgetLevel, String[] tags, String density,
                  int displayOrder) {
        this.userId = userId;
        this.title = title;
        this.destination = destination;
        this.startDate = startDate;
        this.endDate = endDate;
        this.nights = nights;
        this.groupType = groupType;
        this.budgetLevel = budgetLevel;
        this.tags = tags != null ? tags : new String[]{};
        this.density = density;
        this.isPublic = false;
        this.saveCount = 0;
        this.displayOrder = displayOrder;
    }

    public void updateDisplayOrder(int displayOrder) {
        this.displayOrder = displayOrder;
    }

    public void updateVisibility(boolean isPublic) {
        this.isPublic = isPublic;
    }

    public void updateDepartureAt(OffsetDateTime departureAt) {
        this.departureAt = departureAt;
    }

    public void updateReturnAt(OffsetDateTime returnAt) {
        this.returnAt = returnAt;
    }

    public void incrementSaveCount() {
        this.saveCount += 1;
    }
}

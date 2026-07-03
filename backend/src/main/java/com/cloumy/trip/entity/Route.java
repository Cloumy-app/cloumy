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

    @Column(name = "transport_mode")
    private String transportMode;

    @Column(name = "is_public", nullable = false)
    private boolean isPublic = false;

    @Column(name = "save_count", nullable = false)
    private int saveCount = 0;

    @Builder
    private Route(UUID userId, String title, String destination,
                  LocalDate startDate, LocalDate endDate, int nights,
                  String groupType, String budgetLevel, String[] tags, String density,
                  String transportMode) {
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
        this.transportMode = transportMode;
        this.isPublic = false;
        this.saveCount = 0;
    }
}

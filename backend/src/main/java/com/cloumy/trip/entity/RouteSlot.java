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

import java.time.LocalTime;
import java.util.UUID;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "route_slots")
public class RouteSlot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "route_id", nullable = false)
    private UUID routeId;

    @Column(name = "place_id", nullable = false)
    private UUID placeId;

    @Column(name = "day_number", nullable = false)
    private int dayNumber;

    @Column(name = "order_index", nullable = false)
    private int orderIndex;

    @Column(name = "start_time")
    private LocalTime startTime;

    @Column(name = "duration_minutes")
    private Integer durationMinutes;

    @Column(name = "estimated_cost")
    private Integer estimatedCost;

    @Column(name = "is_pinned", nullable = false)
    private boolean pinned;

    @Column(name = "transport_to_next")
    private String transportToNext;

    @Column(name = "transport_minutes")
    private Integer transportMinutes;

    private String tips;

    @Builder
    private RouteSlot(UUID routeId, UUID placeId, int dayNumber, int orderIndex,
                      Integer durationMinutes, Integer estimatedCost, String tips) {
        this.routeId = routeId;
        this.placeId = placeId;
        this.dayNumber = dayNumber;
        this.orderIndex = orderIndex;
        this.durationMinutes = durationMinutes;
        this.estimatedCost = estimatedCost;
        this.tips = tips;
        this.pinned = false;
    }

    public void togglePin() {
        this.pinned = !this.pinned;
    }
}

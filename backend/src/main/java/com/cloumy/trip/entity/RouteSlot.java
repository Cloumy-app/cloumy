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

    @Column(name = "transit_summary")
    private String transitSummary;

    @Column(name = "transit_detail")
    private String transitDetail;

    private String tips;

    @Builder
    private RouteSlot(UUID routeId, UUID placeId, int dayNumber, int orderIndex,
                      LocalTime startTime, Integer durationMinutes, Integer estimatedCost, String tips,
                      String transportToNext, Integer transportMinutes, String transitSummary,
                      String transitDetail) {
        this.routeId = routeId;
        this.placeId = placeId;
        this.dayNumber = dayNumber;
        this.orderIndex = orderIndex;
        this.startTime = startTime;
        this.durationMinutes = durationMinutes;
        this.estimatedCost = estimatedCost;
        this.tips = tips;
        this.transportToNext = transportToNext;
        this.transportMinutes = transportMinutes;
        this.transitSummary = transitSummary;
        this.transitDetail = transitDetail;
        this.pinned = false;
    }

    public void togglePin() {
        this.pinned = !this.pinned;
    }

    // 사전 고정 슬롯(콘서트 앵커/공유 루트 가져오기 공통 기반) — AI 생성 시작 전에 미리
    // is_pinned=true로 만들어둔다. 생성자가 항상 pinned=false로 시작하므로 builder()로
    // 만든 뒤 togglePin()으로 뒤집는다(별도 필드/생성자 파라미터 추가보다 변경 범위가 작음).
    public static RouteSlot createFixed(
            UUID routeId, UUID placeId, int dayNumber, int tempOrderIndex, Integer durationMinutes) {
        RouteSlot slot = RouteSlot.builder()
                .routeId(routeId)
                .placeId(placeId)
                .dayNumber(dayNumber)
                .orderIndex(tempOrderIndex)
                .durationMinutes(durationMinutes)
                .build();
        slot.togglePin();
        return slot;
    }

    // 챗봇 추천 장소를 기존 슬롯 사이에 삽입할 때, 뒤 슬롯들의 order_index를 미는 데 사용
    public void shiftOrderIndex(int delta) {
        this.orderIndex += delta;
    }

    // 드래그 재정렬 — 임의 순열이라 상대값(delta)이 아닌 절대값 지정이 필요
    public void updateOrderIndex(int orderIndex) {
        this.orderIndex = orderIndex;
    }

    // duration_minutes/transport_minutes 누적으로 역산한 시작 시각 반영(recomputeStartTimesForDay)
    public void updateStartTime(LocalTime startTime) {
        this.startTime = startTime;
    }

    public void replacePlace(UUID placeId, Integer estimatedCost, String tips) {
        this.placeId = placeId;
        this.estimatedCost = estimatedCost;
        this.tips = tips;
    }

    public void updateTransport(
            String transportToNext, Integer transportMinutes, String transitSummary, String transitDetail) {
        this.transportToNext = transportToNext;
        this.transportMinutes = transportMinutes;
        this.transitSummary = transitSummary;
        this.transitDetail = transitDetail;
    }
}

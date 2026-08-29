package com.cloumy.trip.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

public record RouteGenRequest(
        @NotBlank String destination,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate,
        @NotBlank
        @Pattern(regexp = "(?i)(solo|couple|friends|family)", message = "지원하지 않는 동행 유형입니다")
        String groupType,
        @NotBlank
        @Pattern(regexp = "(?i)(tight|budget|mid|premium|luxury)", message = "지원하지 않는 예산 단계입니다")
        String budgetLevel,
        List<String> tags,
        @DecimalMin("0.0") @DecimalMax("1.0") Double hiddenGemRatio,
        // null이면 RouteService가 "normal"로 채운다 — @Pattern은 null을 통과시키므로 그대로 둔다
        @Pattern(regexp = "(?i)(relaxed|normal|packed)", message = "지원하지 않는 일정 밀도입니다")
        String density,
        List<@Valid AccommodationCreateRequest> accommodations,
        // 숙박비 제외 현지 활동/식사 예산 — 선택 사항(숙소 선택과 동일 UX, null이면 예산 기능 자체를 건너뜀)
        @Min(1) Integer totalBudget,
        String language, // ko/en/ja/zh — 앱 설정 언어(선택 사항, 챗봇과 동일 패턴)
        // 생성 전 이미 확정된 장소 — day_number + placeId. 사전 고정 슬롯 기반(공유 루트 가져오기/콘서트 앵커가 공통으로 사용)
        List<@Valid FixedSlotRequest> fixedSlots,
        // 공유 루트 가져오기 — fixedSlots를 가져온 원본 루트 id 목록. AI 파이프라인엔 전달 안 하고
        // Spring 레이어에서 save_count 증가 용도로만 소비
        List<UUID> sourceRouteIds
) {
    @AssertTrue(message = "종료일은 시작일 이후여야 합니다")
    public boolean isDateRangeValid() {
        return startDate == null || endDate == null || endDate.isAfter(startDate);
    }

    public int nights() {
        return (int) ChronoUnit.DAYS.between(startDate, endDate);
    }

    public List<AccommodationCreateRequest> accommodationsOrEmpty() {
        return accommodations != null ? accommodations : List.of();
    }

    public List<FixedSlotRequest> fixedSlotsOrEmpty() {
        return fixedSlots != null ? fixedSlots : List.of();
    }

    public List<UUID> sourceRouteIdsOrEmpty() {
        return sourceRouteIds != null ? sourceRouteIds : List.of();
    }
}

package com.cloumy.trip.dto;

// 네이티브 쿼리 결과 매핑용 인터페이스 프로젝션
// 컬럼 alias가 getter 이름(camelCase)과 일치해야 Spring Data가 자동 바인딩함
public interface SlotProjection {
    String getId();
    String getPlaceId();
    Integer getDayNumber();
    Integer getOrderIndex();
    Boolean getPinned();
    String getStartTime();
    Integer getDurationMinutes();
    Integer getEstimatedCost();
    String getTransportToNext();
    Integer getTransportMinutes();
    String getTransitSummary();
    String getTransitDetail();
    String getTips();
    String getPlaceName();
    String getAddress();
    Double getLat();
    Double getLng();
    Integer getAvgDurationMinutes();
}

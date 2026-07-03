package com.cloumy.trip.dto;

import java.time.LocalDate;

// 네이티브 쿼리 결과 매핑용 — alias가 getter 이름(camelCase)과 일치해야 함
public interface AccommodationProjection {
    String getId();
    String getName();
    String getAddress();
    Double getLat();
    Double getLng();
    LocalDate getCheckInDate();
    LocalDate getCheckOutDate();
    String getSource();
}

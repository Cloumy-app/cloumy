package com.cloumy.trip.dto;

// JPQL 인터페이스 프로젝션 — alias가 getter 이름(camelCase)과 일치해야 함
public interface CategoryTotalProjection {
    String getCategory();
    int getTotal();
}

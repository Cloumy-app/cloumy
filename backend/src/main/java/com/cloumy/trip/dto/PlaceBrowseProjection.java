package com.cloumy.trip.dto;

// 네이티브 쿼리 결과 매핑용 — alias가 getter 이름(camelCase)과 일치해야 함
public interface PlaceBrowseProjection {
    String getId();
    String getName();
    String getAddress();
    String[] getCategoryTags();
    Boolean getIsHiddenGem();
    Boolean getIsBookmarked();
}

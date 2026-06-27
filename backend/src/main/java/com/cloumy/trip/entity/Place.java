package com.cloumy.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;

import java.util.UUID;

// location(GEOGRAPHY), embedding(vector), *_tags(TEXT[]), business_hours(JSONB) 은
// JPA 매핑 불가 → 네이티브 쿼리에서 직접 처리
@Getter
@Entity
@Table(name = "places")
public class Place {

    @Id
    private UUID id;

    private String name;
    private String address;

    @Column(name = "avg_duration_minutes")
    private Integer avgDurationMinutes;

    @Column(name = "is_hidden_gem")
    private boolean hiddenGem;
}

package com.cloumy.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.UUID;

// location(GEOGRAPHY)은 JPA 매핑 불가 → AccommodationRepository의 네이티브 쿼리에서 직접 처리
// (Place.java와 동일 패턴). 단 Place와 달리 Spring이 직접 INSERT까지 하므로 이 엔티티로
// save()는 쓰지 않고, id는 서비스에서 미리 생성해 네이티브 INSERT에 같이 넘긴다.
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "accommodations")
public class Accommodation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "route_id", nullable = false)
    private UUID routeId;

    private String name;
    private String address;

    @Column(name = "check_in_date", nullable = false)
    private LocalDate checkInDate;

    @Column(name = "check_out_date", nullable = false)
    private LocalDate checkOutDate;

    private String source;
}

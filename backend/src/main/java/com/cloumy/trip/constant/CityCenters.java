package com.cloumy.trip.constant;

import java.util.Map;

public final class CityCenters {

    private CityCenters() {
    }

    // ai/app/config/city_centers.py와 동일 — (lng, lat) 순서, ST_MakePoint 인자 순서와 일치
    public static final Map<String, double[]> COORDS = Map.ofEntries(
            Map.entry("서울", new double[]{126.9780, 37.5665}),
            Map.entry("부산", new double[]{129.0756, 35.1796}),
            Map.entry("제주", new double[]{126.5312, 33.4996}),
            Map.entry("경주", new double[]{129.2114, 35.8562}),
            Map.entry("강릉", new double[]{128.8761, 37.7519}),
            Map.entry("전주", new double[]{127.1490, 35.8242}),
            Map.entry("여수", new double[]{127.6622, 34.7604}),
            Map.entry("인천", new double[]{126.7052, 37.4563}),
            Map.entry("대전", new double[]{127.3845, 36.3504}),
            Map.entry("대구", new double[]{128.6014, 35.8714}),
            Map.entry("광주", new double[]{126.8526, 35.1595}),
            Map.entry("속초", new double[]{128.5918, 38.2070}),
            Map.entry("춘천", new double[]{127.7298, 37.8813}),
            Map.entry("거제", new double[]{128.6211, 34.8800})
    );
}

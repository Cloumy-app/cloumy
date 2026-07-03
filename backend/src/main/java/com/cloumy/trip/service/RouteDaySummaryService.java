package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.DaySummaryResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.RouteDaySummaryRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteDaySummaryService {

    private final RouteRepository routeRepository;
    private final RouteDaySummaryRepository routeDaySummaryRepository;

    // 스트리밍 중 AI ndjson day_summary 한 줄을 저장 — 재전송 시 최신값으로 덮어씀(멱등)
    // REQUIRES_NEW: 슬롯 저장과 독립된 트랜잭션 — 실패해도 슬롯 저장에 영향 없음
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void upsertFromStream(UUID routeId, JsonNode node) {
        int day = node.path("day").asInt(-1);
        String summary = node.path("summary").asText(null);
        if (day < 1 || summary == null || summary.isBlank()) {
            log.warn("day_summary 저장 스킵 — day={} summary={}", day, summary);
            return;
        }
        routeDaySummaryRepository.upsert(routeId, day, summary);
    }

    public List<DaySummaryResponse> getSummaries(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        return routeDaySummaryRepository.findByRouteIdOrderByDayNumber(routeId)
                .stream()
                .map(DaySummaryResponse::from)
                .toList();
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

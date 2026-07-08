package com.cloumy.trip.service;

import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.SlotProjection;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.entity.RouteDaySummary;
import com.cloumy.trip.repository.RouteDaySummaryRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

// FastAPI 장애 시 폴백 — DB에서 유사 루트를 찾아 AI 스트리밍과 동일한 ndjson 라인 포맷으로 변환한다.
// (Redis 재확인은 여기서 하지 않음 — AiServiceClient가 이미 같은 캐시 키로 FastAPI 호출 전에 확인했으므로,
//  accommodations 없는 요청은 이 시점에 재조회해도 항상 미스. accommodations가 있는 요청은
//  애초에 캐시를 안 보고 오지만, 그 경우까지 챙기면 복잡도만 늘고 실익이 적어 생략함)
@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class FallbackRouteService {

    private final RouteRepository routeRepository;
    private final RouteSlotRepository routeSlotRepository;
    private final RouteDaySummaryRepository routeDaySummaryRepository;
    private final ObjectMapper objectMapper;

    public Optional<List<String>> findFallbackLines(RouteGenRequest req) {
        List<String> tags = req.tags() != null ? req.tags() : List.of();
        String tagsCsv = String.join(",", tags);
        List<Route> candidates = routeRepository.findSimilarRoutes(req.destination(), req.nights(), tagsCsv);

        for (Route candidate : candidates) {
            List<SlotProjection> slots = routeSlotRepository.findSlotsByRouteId(candidate.getId());
            if (slots.isEmpty()) {
                continue;
            }
            log.info("폴백 유사 루트 매칭: candidateRouteId={}, destination={}", candidate.getId(), req.destination());
            return Optional.of(buildLines(candidate.getId(), slots));
        }
        return Optional.empty();
    }

    private List<String> buildLines(UUID routeId, List<SlotProjection> slots) {
        List<String> lines = new ArrayList<>();

        for (RouteDaySummary summary : routeDaySummaryRepository.findByRouteIdOrderByDayNumber(routeId)) {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("type", "day_summary");
            node.put("day", summary.getDayNumber());
            node.put("summary", summary.getSummary());
            node.put("is_fallback", true);
            lines.add(node.toString());
        }

        for (SlotProjection slot : slots) {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("place_id", slot.getPlaceId());
            node.put("day", slot.getDayNumber());
            node.put("order", slot.getOrderIndex() + 1); // DB 0-indexed → AI 1-indexed
            node.put("duration_minutes", slot.getDurationMinutes());
            node.put("budget_estimate", slot.getEstimatedCost());
            if (slot.getTips() != null) {
                node.put("tip", slot.getTips());
            }
            if (slot.getTransportToNext() != null) {
                node.put("transport_to_next", slot.getTransportToNext());
            }
            if (slot.getTransportMinutes() != null) {
                node.put("transport_minutes", slot.getTransportMinutes());
            }
            if (slot.getTransitSummary() != null) {
                node.put("transit_summary", slot.getTransitSummary());
            }
            setTransitDetail(node, slot.getTransitDetail());
            node.put("is_fallback", true);
            lines.add(node.toString());
        }

        return lines;
    }

    // transit_detail은 DB에 문자열로 저장된 JSON 배열이라, 그대로 넣으면 이중 인코딩된다.
    // 실제 JSON 노드로 파싱해서 끼워 넣어야 saveStreamingSlot이 원래 포맷 그대로 재저장할 수 있다.
    private void setTransitDetail(ObjectNode node, String transitDetailJson) {
        if (transitDetailJson == null || transitDetailJson.isBlank()) {
            return;
        }
        try {
            JsonNode parsed = objectMapper.readTree(transitDetailJson);
            node.set("transit_detail", parsed);
        } catch (Exception e) {
            log.warn("폴백 transit_detail 파싱 실패 (무시): {}", e.getMessage());
        }
    }
}

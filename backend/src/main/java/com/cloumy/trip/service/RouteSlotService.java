package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.SlotAlternativeResponse;
import com.cloumy.trip.dto.SlotResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.entity.RouteSlot;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteSlotService {

    private final RouteRepository routeRepository;
    private final RouteSlotRepository routeSlotRepository;
    private final AiServiceClient aiServiceClient;
    private final ObjectMapper objectMapper;

    // 스트리밍 중 AI ndjson 한 줄을 파싱해 route_slots에 저장
    // places FK 위반(존재하지 않는 place_id) 시 해당 슬롯 건너뜀
    // REQUIRES_NEW: 각 슬롯 저장을 독립 트랜잭션으로 처리 — 실패해도 다음 슬롯에 영향 없음
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void saveStreamingSlot(UUID routeId, String jsonLine) throws com.fasterxml.jackson.core.JsonProcessingException {
        JsonNode node = objectMapper.readTree(jsonLine);
        String placeIdStr = node.path("place_id").asText(null);
        if (placeIdStr == null || placeIdStr.isBlank()) return;

        RouteSlot slot = RouteSlot.builder()
                .routeId(routeId)
                .placeId(UUID.fromString(placeIdStr))
                .dayNumber(node.path("day").asInt(1))
                // AI는 1-indexed order → DB는 0-indexed order_index
                .orderIndex(node.path("order").asInt(1) - 1)
                .durationMinutes(node.path("duration_minutes").asInt(0))
                .estimatedCost(node.path("budget_estimate").asInt(0))
                .tips(node.path("tip").asText(null))
                .build();
        routeSlotRepository.save(slot);
    }

    public List<SlotResponse> getSlots(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        return routeSlotRepository.findSlotsByRouteId(routeId)
                .stream()
                .map(SlotResponse::from)
                .toList();
    }

    @Transactional
    public SlotResponse togglePin(UUID routeId, UUID slotId, UUID userId) {
        verifyOwner(routeId, userId);
        RouteSlot slot = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        slot.togglePin();
        // 변경 감지로 flush — 이후 재조회로 최신 상태 반환
        routeSlotRepository.flush();
        return routeSlotRepository.findSlotsByRouteId(routeId)
                .stream()
                .filter(p -> p.getId().equals(slotId.toString()))
                .findFirst()
                .map(SlotResponse::from)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
    }

    @Transactional
    public void deleteSlot(UUID routeId, UUID slotId, UUID userId) {
        verifyOwner(routeId, userId);
        RouteSlot slot = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        if (slot.isPinned()) {
            throw new BusinessException(ErrorCode.SLOT_PINNED);
        }
        routeSlotRepository.delete(slot);
    }

    public List<SlotAlternativeResponse> getAlternatives(UUID routeId, UUID slotId, UUID userId) {
        verifyOwner(routeId, userId);
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));

        List<SlotResponse> allSlots = routeSlotRepository.findSlotsByRouteId(routeId)
                .stream().map(SlotResponse::from).toList();

        SlotResponse target = allSlots.stream()
                .filter(s -> s.id().equals(slotId))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));

        // 같은 Day의 인접 슬롯을 동선 참고용으로 전달
        List<AiServiceClient.NearbySlotDto> nearby = allSlots.stream()
                .filter(s -> s.dayNumber() == target.dayNumber() && !s.id().equals(slotId))
                .map(s -> new AiServiceClient.NearbySlotDto(s.placeName(), s.lat(), s.lng()))
                .toList();

        List<String> tags = route.getTags() != null
                ? Arrays.asList(route.getTags()) : List.of();

        return aiServiceClient.getSlotAlternatives(
                slotId.toString(),
                target.placeName(),
                route.getDestination(),
                tags,
                route.getBudgetLevel(),
                nearby
        );
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

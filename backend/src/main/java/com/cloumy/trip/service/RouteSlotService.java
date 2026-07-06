package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.dto.ReplaceSlotRequest;
import com.cloumy.trip.dto.SlotAlternativeResponse;
import com.cloumy.trip.dto.SlotResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.entity.RouteSlot;
import com.cloumy.trip.repository.PlaceRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteSlotService {

    // AI(route_service.py)의 DAY_START_TIME과 동일한 값 — 슬롯 삽입/교체 후 재계산에도 동일 기준 사용
    private static final LocalTime DAY_START_TIME = LocalTime.of(9, 0);

    // 챗봇 삽입 시 라우트에 이동수단이 지정 안 돼 있어도(transport_mode == null) 이동정보를
    // 아예 안 보여주는 대신 자동차 근사치라도 채우기 위한 기본값. enrich_transport()가
    // walk가 아니면 전부 자동차 속도로 근사하는 구조라 AI 쪽 변경 없이 그대로 재사용 가능.
    private static final String DEFAULT_TRANSPORT_MODE = "car";

    private final RouteRepository routeRepository;
    private final RouteSlotRepository routeSlotRepository;
    private final PlaceRepository placeRepository;
    private final RouteDaySummaryService routeDaySummaryService;
    private final AiServiceClient aiServiceClient;
    private final ObjectMapper objectMapper;

    // 스트리밍 중 AI ndjson 한 줄을 타입("day_summary" vs 슬롯)에 따라 다른 저장 경로로 분기
    // REQUIRES_NEW를 여기 명시해야 함: saveStreamingSlot()을 this.로 self-invocation하면
    // Spring AOP 프록시를 우회해 그 메서드 자신의 @Transactional이 무시되고, 클래스 레벨의
    // readOnly=true 트랜잭션 안에서 실행되어 INSERT가 조용히 무효화된다(자기호출 프록시 우회 함정).
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveStreamingLine(UUID routeId, String jsonLine) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(jsonLine);
        if ("day_summary".equals(node.path("type").asText(null))) {
            routeDaySummaryService.upsertFromStream(routeId, node);
        } else {
            saveStreamingSlot(routeId, jsonLine);
        }
    }

    // 스트리밍 중 AI ndjson 한 줄을 파싱해 route_slots에 저장
    // places FK 위반(존재하지 않는 place_id) 시 해당 슬롯 건너뜀
    // REQUIRES_NEW: 각 슬롯 저장을 독립 트랜잭션으로 처리 — 실패해도 다음 슬롯에 영향 없음
    // (RouteController에서 직접 호출되는 경로도 있어 이 어노테이션 자체는 유지 — 위 self-invocation
    // 문제는 saveStreamingLine 쪽에 REQUIRES_NEW를 추가해 우회)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveStreamingSlot(UUID routeId, String jsonLine) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(jsonLine);
        String placeIdStr = node.path("place_id").asText(null);
        if (placeIdStr == null || placeIdStr.isBlank()) {
            return;
        }

        int dayNumber = node.path("day").asInt(1);
        int orderIndex = node.path("order").asInt(1) - 1; // AI 1-indexed → DB 0-indexed

        // 동일 슬롯 이미 존재하면 스킵 (Redis 캐시 재생 또는 스트림 재시도 시 중복 방지)
        if (routeSlotRepository.existsByRouteIdAndDayNumberAndOrderIndex(routeId, dayNumber, orderIndex)) {
            return;
        }

        // transport_minutes는 필드 자체가 없는 경우(대부분의 슬롯 — 이동수단 미지정 요청)와
        // 0분인 경우를 구분해야 해서 asInt(0) 대신 has()로 먼저 존재를 확인한다.
        Integer transportMinutes = node.has("transport_minutes")
                ? node.path("transport_minutes").asInt() : null;

        // AI가 duration_minutes/transport_minutes 누적으로 역산한 값("HH:MM") — 항상 채워져서 옴
        String startTimeStr = node.path("start_time").asText(null);
        LocalTime startTime = startTimeStr != null ? LocalTime.parse(startTimeStr) : null;

        RouteSlot slot = RouteSlot.builder()
                .routeId(routeId)
                .placeId(UUID.fromString(placeIdStr))
                .dayNumber(dayNumber)
                .orderIndex(orderIndex)
                .startTime(startTime)
                .durationMinutes(node.path("duration_minutes").asInt(0))
                .estimatedCost(node.path("budget_estimate").asInt(0))
                .tips(node.path("tip").asText(null))
                .transportToNext(node.path("transport_to_next").asText(null))
                .transportMinutes(transportMinutes)
                .transitSummary(node.path("transit_summary").asText(null))
                .transitDetail(jsonArrayFieldToString(node, "transit_detail"))
                .build();
        routeSlotRepository.save(slot);
    }

    // transit_detail은 문자열이 아니라 JSON 배열 값이라 asText()(빈 문자열 반환)가 아니라
    // toString()으로 압축 JSON 문자열을 그대로 얻어야 한다(TEXT 컬럼에 문자열로 저장).
    private static String jsonArrayFieldToString(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.toString();
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

    @Transactional
    public List<SlotResponse> replaceSlot(UUID routeId, UUID slotId, UUID userId, ReplaceSlotRequest req) {
        verifyOwner(routeId, userId);
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        RouteSlot target = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        PlaceProjection newPlace = placeRepository.findPlaceDetailById(req.placeId())
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        target.replacePlace(req.placeId(), req.estimatedCost(), req.reason());

        Optional<RouteSlot> prev = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() - 1);
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() + 1);

        if (route.getTransportMode() != null && (prev.isPresent() || next.isPresent())) {
            recalculateNeighborTransport(route.getTransportMode(), req.placeId(), newPlace, target, prev, next);
        }

        // 이동시간이 바뀌면 그 뒤 슬롯들의 start_time도 밀리므로, 이웃 몇 개가 아니라
        // 해당 day 전체를 처음부터 다시 계산한다(day당 슬롯 수가 적어 비용 무시 가능).
        recomputeStartTimesForDay(routeId, target.getDayNumber());
        routeSlotRepository.flush();

        int affectedDay = target.getDayNumber();
        return routeSlotRepository.findSlotsByRouteId(routeId).stream()
                .filter(p -> affectedDay == p.getDayNumber())
                .map(SlotResponse::from)
                .toList();
    }

    // duration_minutes/transport_minutes 누적으로 start_time을 처음부터 다시 계산한다.
    // 부분 재계산(변경 지점 이후만) 대신 day 전체를 다시 계산하는 이유: 슬롯 삽입/삭제/교체가
    // 뒤섞여도 항상 정답을 보장하는 가장 단순한 방법이고, day당 슬롯 수가 적어 비용도 무시할 수준.
    private void recomputeStartTimesForDay(UUID routeId, int dayNumber) {
        List<RouteSlot> slots = routeSlotRepository.findByRouteIdAndDayNumberOrderByOrderIndex(routeId, dayNumber);
        LocalTime current = DAY_START_TIME;
        for (RouteSlot slot : slots) {
            slot.updateStartTime(current);
            int duration = slot.getDurationMinutes() != null ? slot.getDurationMinutes() : 0;
            int transport = slot.getTransportMinutes() != null ? slot.getTransportMinutes() : 0;
            current = current.plusMinutes(duration + transport);
        }
    }

    // 교체된 슬롯과 직접 이웃(order_index ±1)한 구간만 재계산한다(같은 날 전체 재계산은 범위 밖).
    // 이동시간 계산 로직은 새로 만들지 않고 AI의 enrich_transport를 그대로 재사용(DRY).
    private void recalculateNeighborTransport(
            String transportMode, UUID newPlaceId, PlaceProjection newPlace,
            RouteSlot target, Optional<RouteSlot> prev, Optional<RouteSlot> next
    ) {
        List<AiServiceClient.TransportSlotDto> ordered = new ArrayList<>();
        prev.ifPresent(p -> {
            PlaceProjection prevPlace = placeRepository.findPlaceDetailById(p.getPlaceId())
                    .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
            ordered.add(new AiServiceClient.TransportSlotDto(
                    p.getPlaceId().toString(), prevPlace.getLat(), prevPlace.getLng()));
        });
        ordered.add(new AiServiceClient.TransportSlotDto(newPlaceId.toString(), newPlace.getLat(), newPlace.getLng()));
        next.ifPresent(n -> {
            PlaceProjection nextPlace = placeRepository.findPlaceDetailById(n.getPlaceId())
                    .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
            ordered.add(new AiServiceClient.TransportSlotDto(
                    n.getPlaceId().toString(), nextPlace.getLat(), nextPlace.getLng()));
        });

        List<AiServiceClient.TransportSlotResult> results = aiServiceClient.getSlotTransport(transportMode, ordered);

        // AI 호출 자체가 실패(빈 리스트)하면 영향 구간을 null로 리셋 —
        // place가 이미 바뀌었으므로 옛 값을 그대로 두면 "정보 없음"보다 더 나쁜 틀린 정보가 된다.
        if (results.size() != ordered.size()) {
            prev.ifPresent(p -> p.updateTransport(null, null, null, null));
            target.updateTransport(null, null, null, null);
            return;
        }

        // ordered[i] -> ordered[i+1] 구간 결과가 results[i]에 담겨 옴 (enrich_transport 규약과 동일)
        int idx = 0;
        if (prev.isPresent()) {
            AiServiceClient.TransportSlotResult r = results.get(idx++);
            prev.get().updateTransport(r.transport_to_next(), r.transport_minutes(), r.transit_summary(),
                    transitDetailToString(r.transit_detail()));
        }
        if (next.isPresent()) {
            AiServiceClient.TransportSlotResult r = results.get(idx);
            target.updateTransport(r.transport_to_next(), r.transport_minutes(), r.transit_summary(),
                    transitDetailToString(r.transit_detail()));
        }
    }

    // 챗봇이 추천한 장소를 afterSlot과 그 다음 슬롯 사이에 새 슬롯으로 끼워 넣는다.
    @Transactional
    public List<SlotResponse> insertSlotAfter(
            UUID routeId, UUID userId, UUID afterSlotId, UUID placeId, String reason) {
        verifyOwner(routeId, userId);
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        RouteSlot afterSlot = routeSlotRepository.findById(afterSlotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        PlaceProjection newPlace = placeRepository.findPlaceDetailById(placeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        int dayNumber = afterSlot.getDayNumber();
        int insertOrderIndex = afterSlot.getOrderIndex() + 1;

        // "원래 다음 슬롯"은 order_index를 밀기 전에 먼저 확보해야 한다 — 밀고 나면 값이 바뀐다.
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, dayNumber, insertOrderIndex);

        // 뒤 슬롯들을 order_index 큰 값부터 내림차순으로 +1씩 밀어 삽입 자리를 비운다.
        // 오름차순으로 밀면 (route_id, day_number, order_index) UNIQUE 제약과 중간에 충돌한다.
        // 개별 flush 필수: Hibernate가 이 UPDATE들을 JDBC batch로 묶으면 리스트 순서를
        // 보존한다는 보장이 없어(실측: 배치로 묶었더니 내림차순 의도와 다르게 실행돼
        // uk_route_slots_day_order 위반 발생) — 한 건씩 flush해 실행 순서를 강제한다.
        List<RouteSlot> shifting = routeSlotRepository
                .findByRouteIdAndDayNumberAndOrderIndexGreaterThanOrderByOrderIndexDesc(
                        routeId, dayNumber, afterSlot.getOrderIndex());
        for (RouteSlot s : shifting) {
            s.shiftOrderIndex(1);
            routeSlotRepository.flush();
        }

        // durationMinutes를 비워두면(0으로 취급) start_time 캐스케이드에서 이 슬롯 체류시간이
        // 0분으로 계산돼 다음 슬롯과 시각이 겹쳐 보인다 — 장소의 평균 체류시간으로 기본값을 채운다.
        // reason은 챗봇 추천 카드의 한줄 설명 — Pin&Reshuffle이 대안 교체 시 tips에 reason을
        // 저장하는 것과 동일한 방식으로, 삽입된 슬롯도 SlotCard.tsx가 그대로 표시할 수 있게 tips에 저장
        RouteSlot newSlot = RouteSlot.builder()
                .routeId(routeId)
                .placeId(placeId)
                .dayNumber(dayNumber)
                .orderIndex(insertOrderIndex)
                .durationMinutes(newPlace.getAvgDurationMinutes())
                .tips(reason)
                .build();
        routeSlotRepository.save(newSlot);

        // replaceSlot과 동일한 이웃 이동정보 재계산 재사용: afterSlot(prev)→newSlot(target)→next
        // 라우트에 이동수단이 지정 안 돼 있으면 DEFAULT_TRANSPORT_MODE("car")로 대체 —
        // 챗봇으로 장소를 추가했는데 "어떻게 가는지" 정보가 아예 안 붙는 체감 버그 방지.
        String effectiveTransportMode = route.getTransportMode() != null
                ? route.getTransportMode() : DEFAULT_TRANSPORT_MODE;
        recalculateNeighborTransport(
                effectiveTransportMode, placeId, newPlace, newSlot, Optional.of(afterSlot), next);

        // 새 슬롯이 끼어들면서 그 뒤 모든 슬롯의 시작 시각이 밀리므로 day 전체 재계산
        recomputeStartTimesForDay(routeId, dayNumber);
        routeSlotRepository.flush();

        return routeSlotRepository.findSlotsByRouteId(routeId).stream()
                .map(SlotResponse::from)
                .toList();
    }

    // AI 응답의 transit_detail(JsonNode, 불투명 JSON blob)을 TEXT 컬럼에 저장할 문자열로 변환.
    private static String transitDetailToString(JsonNode transitDetail) {
        return transitDetail == null || transitDetail.isNull() ? null : transitDetail.toString();
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

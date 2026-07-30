package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.FixedSlotRequest;
import com.cloumy.trip.dto.ManualSlotRequest;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteSlotService {

    // AI(route_service.py)의 DAY_START_TIME과 동일한 값 — 슬롯 삽입/교체 후 재계산에도 동일 기준 사용
    private static final LocalTime DAY_START_TIME = LocalTime.of(9, 0);

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
        } else if (node.path("is_fixed").asBoolean(false)) {
            applyFixedSlotResult(routeId, node);
        } else {
            saveStreamingSlot(routeId, jsonLine);
        }
    }

    // 사전 고정 슬롯 기반 — FastAPI가 "is_fixed": true로 흘려보낸 라인은 INSERT가 아니라
    // createFixedSlots()가 이미 저장해둔 pinned 슬롯의 최종 순서/이동정보를 UPDATE한다.
    private void applyFixedSlotResult(UUID routeId, JsonNode node) {
        String placeIdStr = node.path("place_id").asText(null);
        if (placeIdStr == null || placeIdStr.isBlank()) {
            return;
        }
        int dayNumber = node.path("day").asInt(1);

        Optional<RouteSlot> slotOpt = routeSlotRepository
                .findByRouteIdAndDayNumberAndPlaceIdAndPinnedTrue(routeId, dayNumber, UUID.fromString(placeIdStr));
        if (slotOpt.isEmpty()) {
            log.warn("고정 슬롯 결과 적용 실패 — 대상 없음: routeId={}, day={}, placeId={}",
                    routeId, dayNumber, placeIdStr);
            return;
        }
        RouteSlot slot = slotOpt.get();
        slot.updateOrderIndex(node.path("order").asInt(1) - 1); // AI 1-indexed → DB 0-indexed

        String startTimeStr = node.path("start_time").asText(null);
        if (startTimeStr != null) {
            slot.updateStartTime(LocalTime.parse(startTimeStr));
        }

        Integer transportMinutes = node.has("transport_minutes")
                ? node.path("transport_minutes").asInt() : null;
        slot.updateTransport(
                node.path("transport_to_next").asText(null),
                transportMinutes,
                node.path("transit_summary").asText(null),
                jsonArrayFieldToString(node, "transit_detail"));
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

    // 사전 고정 슬롯 기반 — FastAPI가 좌표를 재조회 없이 바로 쓸 수 있도록 place 좌표까지 포함해 반환.
    public record FixedSlotResult(UUID placeId, int dayNumber, double lat, double lng, Integer durationMinutes) {}

    // 생성 요청에 실려온 확정 장소를 AI 스트리밍 시작 전에 pinned=true route_slots로 즉시 저장한다.
    // order_index는 day별 실제 인덱스와 절대 안 겹치는 임시값 — 실제 값은 FastAPI가 그 day를
    // 마무리하는 시점에 TSP로 재정렬한 결과가 스트리밍으로 내려오면 applyFixedSlotResult()가 덮어쓴다.
    @Transactional
    public List<FixedSlotResult> createFixedSlots(UUID routeId, int nights, List<FixedSlotRequest> fixedSlots) {
        if (fixedSlots.isEmpty()) {
            return List.of();
        }

        Set<UUID> seenPlaceIds = new HashSet<>();
        List<FixedSlotResult> results = new ArrayList<>();
        int tempOrderIndex = 100_000; // reorderSlots의 10_000 오프셋 관례보다 훨씬 큰 값 — 실제 인덱스와 절대 안 겹침

        for (FixedSlotRequest fs : fixedSlots) {
            if (fs.dayNumber() < 1 || fs.dayNumber() > nights + 1) {
                throw new BusinessException(ErrorCode.INVALID_SLOT_ORDER);
            }
            if (!seenPlaceIds.add(fs.placeId())) {
                throw new BusinessException(ErrorCode.INVALID_INPUT, "같은 장소를 중복 고정할 수 없습니다");
            }
            PlaceProjection place = placeRepository.findPlaceDetailById(fs.placeId())
                    .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

            // duration_minutes가 비면 _assign_start_times()가 체류시간을 0분으로 계산해
            // 뒷 슬롯들의 시작 시각이 전부 당겨진다 — insertSlotAfter()와 동일하게 평균 체류시간을 채우되,
            // place에 값이 없는 경우까지 대비해 최소 기본값(60분)으로 폴백한다.
            Integer duration = place.getAvgDurationMinutes() != null ? place.getAvgDurationMinutes() : 60;

            RouteSlot slot = RouteSlot.createFixed(routeId, fs.placeId(), fs.dayNumber(), tempOrderIndex++, duration);
            routeSlotRepository.save(slot);
            results.add(new FixedSlotResult(fs.placeId(), fs.dayNumber(), place.getLat(), place.getLng(), duration));
        }
        return results;
    }

    public List<SlotResponse> getSlots(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        return listSlots(routeId);
    }

    // 공유 루트 가져오기 — 소유자 전용 verifyOwner 대신 route.isPublic()만 확인한다.
    // 기존 getSlots()에 isPublic || owner 조건을 끼워 넣지 않고 아예 메서드를 분리한 이유:
    // 나중에 조건을 잘못 바꾸면 사생활 루트가 새어나갈 위험이 있어, 코드 경로 자체를 나누는
    // 쪽이 더 안전하다(스펙의 접근 제어 원칙).
    public List<SlotResponse> getPublicSlots(UUID routeId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.isPublic()) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        return listSlots(routeId);
    }

    private List<SlotResponse> listSlots(UUID routeId) {
        return routeSlotRepository.findSlotsByRouteId(routeId)
                .stream()
                .map(SlotResponse::from)
                .toList();
    }

    // 루트/커뮤니티 탭 신설 — 전체 가져오기(clone). 시간 재계산 없이 스냅샷 그대로 복사한다
    // (원본과 동일한 일정 구조를 보존하는 게 목적 — 새 여행 날짜가 달라도 day_number/order_index
    // 기준 상대적 일정은 그대로 유지됨)
    @Transactional
    public void cloneSlots(UUID sourceRouteId, UUID targetRouteId) {
        List<RouteSlot> originals = routeSlotRepository.findByRouteIdOrderByDayNumberAscOrderIndexAsc(sourceRouteId);
        for (RouteSlot s : originals) {
            routeSlotRepository.save(RouteSlot.builder()
                    .routeId(targetRouteId)
                    .placeId(s.getPlaceId())
                    .dayNumber(s.getDayNumber())
                    .orderIndex(s.getOrderIndex())
                    .startTime(s.getStartTime())
                    .durationMinutes(s.getDurationMinutes())
                    .estimatedCost(s.getEstimatedCost())
                    .tips(s.getTips())
                    .transportToNext(s.getTransportToNext())
                    .transportMinutes(s.getTransportMinutes())
                    .transitSummary(s.getTransitSummary())
                    .transitDetail(s.getTransitDetail())
                    .build());
        }
    }

    // 루트/커뮤니티 탭 신설 — 수동 루트 작성. day별로 요청 리스트 안에서의 등장 순서를
    // order_index로 그대로 부여(시간·비용·이동정보는 스코프 밖이라 전부 null)
    @Transactional
    public void createManualSlots(UUID routeId, List<ManualSlotRequest> slots) {
        Map<Integer, Integer> orderCounter = new HashMap<>();
        for (ManualSlotRequest s : slots) {
            int orderIndex = orderCounter.merge(s.dayNumber(), 1, Integer::sum) - 1;
            routeSlotRepository.save(RouteSlot.builder()
                    .routeId(routeId)
                    .placeId(s.placeId())
                    .dayNumber(s.dayNumber())
                    .orderIndex(orderIndex)
                    .build());
        }
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
        RouteSlot target = routeSlotRepository.findById(slotId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND));
        PlaceProjection newPlace = placeRepository.findPlaceDetailById(req.placeId())
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        target.replacePlace(req.placeId(), req.estimatedCost(), req.reason());

        Optional<RouteSlot> prev = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() - 1);
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, target.getDayNumber(), target.getOrderIndex() + 1);

        if (prev.isPresent() || next.isPresent()) {
            recalculateNeighborTransport(req.placeId(), newPlace, target, prev, next);
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

    // 상세보기 드래그 재정렬 — 같은 day 안에서 슬롯 순서를 통째로 교체한다.
    @Transactional
    public List<SlotResponse> reorderSlots(UUID routeId, UUID userId, int dayNumber, List<UUID> slotIds) {
        verifyOwner(routeId, userId);
        List<RouteSlot> current = routeSlotRepository.findByRouteIdAndDayNumberOrderByOrderIndex(routeId, dayNumber);

        Set<UUID> currentIds = current.stream().map(RouteSlot::getId).collect(Collectors.toSet());
        if (current.size() != slotIds.size() || !currentIds.equals(new HashSet<>(slotIds))) {
            throw new BusinessException(ErrorCode.INVALID_SLOT_ORDER);
        }

        Map<UUID, RouteSlot> byId = current.stream()
                .collect(Collectors.toMap(RouteSlot::getId, s -> s, (a, b) -> a, HashMap::new));

        // 1차: (route_id, day_number, order_index) 유니크 제약 회피용 임시 오프셋.
        // order_index >= 0 CHECK 제약이 있어 insertSlotAfter처럼 음수 트릭을 못 쓴다 —
        // 하루 슬롯 수보다 훨씬 큰 오프셋을 써서 실제 인덱스와 절대 겹치지 않게 한다.
        for (int i = 0; i < slotIds.size(); i++) {
            byId.get(slotIds.get(i)).updateOrderIndex(10_000 + i);
            routeSlotRepository.flush();
        }
        // 2차: 요청받은 순서대로 최종 인덱스 반영
        List<RouteSlot> ordered = new ArrayList<>();
        for (int i = 0; i < slotIds.size(); i++) {
            RouteSlot slot = byId.get(slotIds.get(i));
            slot.updateOrderIndex(i);
            ordered.add(slot);
            routeSlotRepository.flush();
        }

        recalculateDayTransport(ordered);
        recomputeStartTimesForDay(routeId, dayNumber);
        routeSlotRepository.flush();

        return routeSlotRepository.findSlotsByRouteId(routeId).stream()
                .filter(p -> p.getDayNumber() == dayNumber)
                .map(SlotResponse::from)
                .toList();
    }

    // 재정렬된 day 전체 순서로 이동정보를 일괄 재계산한다. getSlotTransport 응답은 입력과
    // 같은 길이(n)로 오고 마지막 원소는 항상 null이라, 그대로 적용하면 새로 마지막이 된
    // 슬롯의 옛 이동정보도 자동으로 지워진다 — recalculateNeighborTransport와 동일 계약 재사용.
    private void recalculateDayTransport(List<RouteSlot> ordered) {
        List<AiServiceClient.TransportSlotDto> dtos = ordered.stream()
                .map(s -> {
                    PlaceProjection p = placeRepository.findPlaceDetailById(s.getPlaceId())
                            .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
                    return new AiServiceClient.TransportSlotDto(s.getPlaceId().toString(), p.getLat(), p.getLng());
                })
                .toList();

        List<AiServiceClient.TransportSlotResult> results = aiServiceClient.getSlotTransport(dtos);

        // AI 호출 실패 시 전체를 null로 리셋 — 순서 자체는 사용자가 원한 변경이니 커밋하되,
        // "정보 없음"보다 나쁜 틀린 이동정보를 남기지 않는다(recalculateNeighborTransport와 동일 원칙).
        if (results.size() != ordered.size()) {
            ordered.forEach(s -> s.updateTransport(null, null, null, null));
            return;
        }
        for (int i = 0; i < ordered.size(); i++) {
            AiServiceClient.TransportSlotResult r = results.get(i);
            ordered.get(i).updateTransport(r.transport_to_next(), r.transport_minutes(), r.transit_summary(),
                    transitDetailToString(r.transit_detail()));
        }
    }

    // 교체된 슬롯과 직접 이웃(order_index ±1)한 구간만 재계산한다(같은 날 전체 재계산은 범위 밖).
    // 이동시간 계산 로직은 새로 만들지 않고 AI의 enrich_transport를 그대로 재사용(DRY).
    private void recalculateNeighborTransport(
            UUID newPlaceId, PlaceProjection newPlace,
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

        List<AiServiceClient.TransportSlotResult> results = aiServiceClient.getSlotTransport(ordered);

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
    // afterSlotId가 null이면 "그 Day 맨 앞"을 의미한다 — 대화에서 "OO 가기 전에"라고 했는데
    // OO가 그날 첫 일정이거나, 아예 빈 Day에 넣는 경우를 표현할 방법이 없어 nullable로 열었다.
    @Transactional
    public List<SlotResponse> insertSlotAfter(
            UUID routeId, UUID userId, UUID afterSlotId, Integer dayNumber, UUID placeId, String reason) {
        verifyOwner(routeId, userId);

        Optional<RouteSlot> afterSlot = afterSlotId == null
                ? Optional.empty()
                : Optional.of(routeSlotRepository.findById(afterSlotId)
                        .orElseThrow(() -> new BusinessException(ErrorCode.SLOT_NOT_FOUND)));

        // 다른 루트(남의 것 포함) slotId를 기준점으로 보내면 그 슬롯의 dayNumber로 내 루트에
        // 꽂혀버린다 — verifyOwner는 routeId 소유만 확인할 뿐 afterSlot이 이 루트 소속인지는
        // 확인하지 않으므로 여기서 별도로 막는다. 데이터가 새는 건 아니지만 엉뚱한 Day에 삽입된다.
        if (afterSlot.isPresent() && !afterSlot.get().getRouteId().equals(routeId)) {
            throw new BusinessException(ErrorCode.SLOT_NOT_FOUND);
        }

        PlaceProjection newPlace = placeRepository.findPlaceDetailById(placeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));

        int day = afterSlot.map(RouteSlot::getDayNumber).orElse(dayNumber);

        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (day < 1 || day > route.getNights() + 1) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "여행 기간을 벗어난 day입니다");
        }

        int insertOrderIndex = afterSlot.map(s -> s.getOrderIndex() + 1).orElse(0);
        // 맨 앞 삽입(afterSlot 없음)이면 -1을 기준으로 삼아 그 Day 전체가 밀림 대상이 된다 —
        // 아래 findByRouteIdAndDayNumberAndOrderIndexGreaterThanOrderByOrderIndexDesc가
        // orderIndex > -1 조건이 되어 0번부터 전부 걸린다.
        int shiftFrom = afterSlot.map(RouteSlot::getOrderIndex).orElse(-1);

        // "원래 다음 슬롯"은 order_index를 밀기 전에 먼저 확보해야 한다 — 밀고 나면 값이 바뀐다.
        Optional<RouteSlot> next = routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(
                routeId, day, insertOrderIndex);

        // 뒤 슬롯들을 order_index 큰 값부터 내림차순으로 +1씩 밀어 삽입 자리를 비운다.
        // 오름차순으로 밀면 (route_id, day_number, order_index) UNIQUE 제약과 중간에 충돌한다.
        // 개별 flush 필수: Hibernate가 이 UPDATE들을 JDBC batch로 묶으면 리스트 순서를
        // 보존한다는 보장이 없어(실측: 배치로 묶었더니 내림차순 의도와 다르게 실행돼
        // uk_route_slots_day_order 위반 발생) — 한 건씩 flush해 실행 순서를 강제한다.
        List<RouteSlot> shifting = routeSlotRepository
                .findByRouteIdAndDayNumberAndOrderIndexGreaterThanOrderByOrderIndexDesc(
                        routeId, day, shiftFrom);
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
                .dayNumber(day)
                .orderIndex(insertOrderIndex)
                .durationMinutes(newPlace.getAvgDurationMinutes())
                .tips(reason)
                .build();
        routeSlotRepository.save(newSlot);

        // replaceSlot과 동일한 이웃 이동정보 재계산 재사용: afterSlot(prev)→newSlot(target)→next.
        // 맨 앞 삽입이면 prev가 없으므로 afterSlot(Optional.empty())을 그대로 넘긴다 —
        // recalculateNeighborTransport는 이미 Optional<RouteSlot> prev를 받으므로 시그니처 변경 불필요.
        // 이제 enrich_transport가 거리 기반으로 자동 판단하므로 이동수단 인자 자체가 불필요.
        recalculateNeighborTransport(placeId, newPlace, newSlot, afterSlot, next);

        // 새 슬롯이 끼어들면서 그 뒤 모든 슬롯의 시작 시각이 밀리므로 day 전체 재계산
        recomputeStartTimesForDay(routeId, day);
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

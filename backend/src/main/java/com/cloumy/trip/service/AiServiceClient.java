package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.ChatResponse;
import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.SlotAlternativeResponse;
import com.cloumy.trip.entity.RouteSlot;
import com.cloumy.trip.repository.PlaceRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceClient {

    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;
    private final PlaceRepository placeRepository;

    @Value("${app.fastapi.url}")
    private String fastapiUrl;

    @Value("${app.internal-api-key}")
    private String internalApiKey;

    // Uvicorn은 HTTP/1.1만 지원 — HTTP/2 업그레이드 시도 시 400 "Invalid HTTP request received." 반환
    private final HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private String cacheKey(RouteGenRequest req) {
        String themes = req.tags() == null ? "" :
                req.tags().stream().sorted().collect(Collectors.joining(":"));
        String ratio = req.hiddenGemRatio() != null
                ? String.format(":%.1f", req.hiddenGemRatio())
                : ":0.2";
        String density = req.density() != null ? req.density().toLowerCase() : "normal";
        // language가 캐시 키에 없으면 다른 언어로 생성된 tip/day_summary가 그대로 재사용됨
        String language = req.language() != null ? req.language() : "ko";
        return String.format("route:%s:%d:%s:%s:%s%s:%s:%s",
                req.destination(), req.nights(), req.groupType(), req.budgetLevel(), themes, ratio, density, language);
    }

    public record NearbySlotDto(String name, double lat, double lng) {}

    // FastAPI AccommodationAnchor와 필드명을 맞춤(snake_case) — 숙소를 하루 시작/종료 고정점으로 사용
    private record AccommodationAnchorDto(
            double lat, double lng, LocalDate check_in_date, LocalDate check_out_date
    ) {}

    // FastAPI FixedSlot과 필드명을 맞춤(snake_case) — 사전 고정 슬롯(콘서트 앵커/공유 루트
    // 가져오기 공통 기반). duration_minutes는 createFixedSlots가 이미 DB에 저장한 값을
    // 그대로 실어 보내 _assign_start_times가 체류시간을 0분으로 계산하는 걸 방지한다.
    private record FixedSlotDto(
            String place_id, int day_number, double lat, double lng, Integer duration_minutes
    ) {}

    private record SlotAlternativesReq(
            String slot_id,
            String place_name,
            String destination,
            List<String> tags,
            String budget_level,
            List<NearbySlotDto> nearby_slots
    ) {}

    public List<SlotAlternativeResponse> getSlotAlternatives(
            String slotId, String placeName, String destination,
            List<String> tags, String budgetLevel,
            List<NearbySlotDto> nearbySlots
    ) {
        try {
            SlotAlternativesReq req = new SlotAlternativesReq(
                    slotId, placeName, destination, tags, budgetLevel, nearbySlots);
            String body = objectMapper.writeValueAsString(req);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(fastapiUrl + "/ai/routes/slots/alternatives"))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Key", internalApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(30))
                    .build();

            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 400) {
                log.error("FastAPI 슬롯 대안 오류: status={}", response.statusCode());
                return List.of();
            }
            return objectMapper.readValue(
                    response.body(), new TypeReference<List<SlotAlternativeResponse>>() {});
        } catch (Exception e) {
            log.error("슬롯 대안 요청 실패: {}", e.getMessage());
            return List.of();
        }
    }

    public record TransportSlotDto(String place_id, double lat, double lng) {}

    // transit_detail은 백엔드가 구조를 알 필요 없이 그대로 저장/응답에 흘려보내기만 하므로
    // 전용 DTO 없이 JsonNode(불투명 JSON blob)로 받는다 — places.business_hours를 다루는 방식과 동일.
    public record TransportSlotResult(
            String place_id, String transport_to_next, Integer transport_minutes,
            String transit_summary, JsonNode transit_detail) {}

    private record SlotTransportReq(List<TransportSlotDto> slots) {}

    public List<TransportSlotResult> getSlotTransport(List<TransportSlotDto> slots) {
        try {
            String body = objectMapper.writeValueAsString(new SlotTransportReq(slots));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(fastapiUrl + "/ai/routes/slots/transport"))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Key", internalApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 400) {
                log.error("FastAPI 슬롯 이동정보 오류: status={}", response.statusCode());
                return List.of();
            }
            return objectMapper.readValue(
                    response.body(), new TypeReference<List<TransportSlotResult>>() {});
        } catch (Exception e) {
            log.error("슬롯 이동정보 요청 실패: {}", e.getMessage());
            return List.of();
        }
    }

    private record ChatLocationDto(double lat, double lng) {}

    private record ChatReq(
            String user_id, String route_id, String message, ChatLocationDto current_location, String language
    ) {}

    public ChatResponse chat(
            String userId, String routeId, String message, Double lat, Double lng, String language) {
        try {
            ChatLocationDto location = (lat != null && lng != null) ? new ChatLocationDto(lat, lng) : null;
            String body = objectMapper.writeValueAsString(
                    new ChatReq(userId, routeId, message, location, language));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(fastapiUrl + "/ai/chat"))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Key", internalApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(15))
                    .build();

            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 404) {
                throw new BusinessException(ErrorCode.ROUTE_NOT_FOUND);
            }
            if (response.statusCode() >= 400) {
                log.error("FastAPI 챗봇 오류: status={}", response.statusCode());
                throw new BusinessException(ErrorCode.INTERNAL_ERROR, "챗봇 응답에 실패했습니다");
            }
            return objectMapper.readValue(response.body(), ChatResponse.class);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("챗봇 요청 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "챗봇 요청에 실패했습니다");
        }
    }

    private record FastApiRequest(
            String city,
            int nights,
            String group_type,
            String budget_level,
            List<String> themes,
            Double hidden_gem_ratio,
            LocalDate start_date,
            String density,
            List<AccommodationAnchorDto> accommodations,
            String language,
            List<FixedSlotDto> fixed_slots
    ) {}

    /**
     * 가상 스레드 안에서 blocking 호출 — 스트림이 끝날 때까지 블록됨.
     * fixedSlots는 RouteSlotService.createFixedSlots()가 이미 DB에 저장해둔 사전 고정
     * 슬롯 목록 — FastAPI가 그 자리를 피해서 생성하고 TSP/이동시간 계산에 포함시키도록 전달.
     */
    public void streamRoute(
            RouteGenRequest req,
            List<RouteSlot> fixedSlots,
            Consumer<String> onLine,
            Runnable onComplete,
            Consumer<Throwable> onError
    ) {
        try {
            // 숙소나 고정 슬롯이 있으면 결과(앵커, 이동시간)가 캐시 키에 안 잡히므로 캐시를 완전히
            // 우회한다(날씨 민감 요청과 동일한 이유) — 안 그러면 그 값이 없던 옛 캐시가 그대로 나간다.
            boolean hasAccommodations = !req.accommodationsOrEmpty().isEmpty();
            boolean hasFixedSlots = fixedSlots != null && !fixedSlots.isEmpty();
            if (!hasAccommodations && !hasFixedSlots) {
                try {
                    String cached = redisTemplate.opsForValue().get(cacheKey(req));
                    if (cached != null && !cached.isBlank()) {
                        log.info("Spring 캐시 히트: {}", cacheKey(req));
                        Arrays.stream(cached.split("\n"))
                                .filter(l -> !l.isBlank())
                                .forEach(onLine);
                        onComplete.run();
                        return;
                    }
                } catch (Exception e) {
                    log.warn("Redis 캐시 조회 실패 — FastAPI 호출로 폴백: {}", e.getMessage());
                }
            }

            List<AccommodationAnchorDto> accommodations = req.accommodationsOrEmpty().stream()
                    .map(a -> new AccommodationAnchorDto(a.lat(), a.lng(), a.checkInDate(), a.checkOutDate()))
                    .toList();

            // 좌표는 RouteSlot에 없어 place를 다시 조회한다 — 목록이 하루 몇 건 수준이라
            // recalculateNeighborTransport 등 기존 코드와 동일하게 재조회 방식으로 단순하게 간다.
            List<FixedSlotDto> fixedSlotDtos = hasFixedSlots ? fixedSlots.stream()
                    .map(s -> {
                        PlaceProjection p = placeRepository.findPlaceDetailById(s.getPlaceId())
                                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
                        return new FixedSlotDto(
                                s.getPlaceId().toString(), s.getDayNumber(), p.getLat(), p.getLng(),
                                s.getDurationMinutes());
                    })
                    .toList() : List.of();

            FastApiRequest fastApiReq = new FastApiRequest(
                    req.destination(),
                    req.nights(),
                    req.groupType().toLowerCase(),
                    req.budgetLevel().toLowerCase(),
                    req.tags() != null ? req.tags() : List.of(),
                    req.hiddenGemRatio(),
                    req.startDate(),
                    req.density() != null ? req.density().toLowerCase() : "normal",
                    accommodations,
                    req.language(),
                    fixedSlotDtos
            );

            String body = objectMapper.writeValueAsString(fastApiReq);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(fastapiUrl + "/ai/routes/generate"))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Key", internalApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(120))
                    .build();

            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofLines());
            if (response.statusCode() >= 400) {
                String errorBody = response.body().collect(Collectors.joining("\n"));
                log.error("FastAPI 오류 응답: status={}, body={}", response.statusCode(), errorBody);
                onError.accept(new RuntimeException("FastAPI 오류: " + response.statusCode()));
                return;
            }
            response.body()
                    .filter(line -> !line.isBlank())
                    .forEach(onLine);

            onComplete.run();

        } catch (Exception e) {
            log.error("FastAPI 스트리밍 오류: {}", e.getMessage());
            onError.accept(e);
        }
    }
}

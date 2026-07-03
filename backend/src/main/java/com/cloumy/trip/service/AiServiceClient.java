package com.cloumy.trip.service;

import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.SlotAlternativeResponse;
import com.fasterxml.jackson.core.type.TypeReference;
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
        return String.format("route:%s:%d:%s:%s:%s%s:%s",
                req.destination(), req.nights(), req.groupType(), req.budgetLevel(), themes, ratio, density);
    }

    public record NearbySlotDto(String name, double lat, double lng) {}

    // FastAPI AccommodationAnchor와 필드명을 맞춤(snake_case) — 숙소를 하루 시작/종료 고정점으로 사용
    private record AccommodationAnchorDto(
            double lat, double lng, LocalDate check_in_date, LocalDate check_out_date
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

    private record FastApiRequest(
            String city,
            int nights,
            String group_type,
            String budget_level,
            List<String> themes,
            Double hidden_gem_ratio,
            LocalDate start_date,
            String density,
            List<AccommodationAnchorDto> accommodations
    ) {}

    /**
     * 가상 스레드 안에서 blocking 호출 — 스트림이 끝날 때까지 블록됨.
     */
    public void streamRoute(
            RouteGenRequest req,
            Consumer<String> onLine,
            Runnable onComplete,
            Consumer<Throwable> onError
    ) {
        try {
            // 숙소가 있으면 앵커가 결과에 반영되므로 캐시를 완전히 우회한다(날씨 민감 요청과 동일한 이유).
            // 숙소 없는 요청까지 캐시를 안 타면 성능 손해라 이 경우에만 조회를 건너뛴다.
            boolean hasAccommodations = !req.accommodationsOrEmpty().isEmpty();
            if (!hasAccommodations) {
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

            FastApiRequest fastApiReq = new FastApiRequest(
                    req.destination(),
                    req.nights(),
                    req.groupType().toLowerCase(),
                    req.budgetLevel().toLowerCase(),
                    req.tags() != null ? req.tags() : List.of(),
                    req.hiddenGemRatio(),
                    req.startDate(),
                    req.density() != null ? req.density().toLowerCase() : "normal",
                    accommodations
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

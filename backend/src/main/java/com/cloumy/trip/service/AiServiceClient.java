package com.cloumy.trip.service;

import com.cloumy.trip.dto.RouteGenRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceClient {

    private final ObjectMapper objectMapper;

    @Value("${app.fastapi.url}")
    private String fastapiUrl;

    @Value("${app.internal-api-key}")
    private String internalApiKey;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    private record FastApiRequest(
            String city,
            int nights,
            String group_type,
            String budget_level,
            List<String> themes
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
            FastApiRequest fastApiReq = new FastApiRequest(
                    req.destination(),
                    req.nights(),
                    req.groupType(),
                    req.budgetLevel(),
                    req.tags() != null ? req.tags() : List.of()
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

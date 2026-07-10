package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.KakaoPlaceDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

// 카카오 REST API 키를 프론트에 노출하지 않기 위한 서버사이드 프록시.
// 숙소 검색 결과와 지도 핀 선택 시 역지오코딩 모두 이 클라이언트를 통해 카카오 단일 소스로 처리한다
// (TourAPI/네이버는 안 씀 — 커버리지·일관성 문제로 카카오로 결정됨).
@Slf4j
@Service
@RequiredArgsConstructor
public class KakaoLocalClient {

    private static final String BASE_URL = "https://dapi.kakao.com/v2/local";
    // 숙박 카테고리 그룹 코드 (카카오 로컬 API 고정 코드)
    private static final String LODGING_CATEGORY = "AD5";

    private final ObjectMapper objectMapper;

    @Value("${app.kakao.rest-api-key}")
    private String kakaoRestApiKey;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    public List<KakaoPlaceDto> searchAccommodation(String keyword) {
        return search(keyword, LODGING_CATEGORY);
    }

    // "직접 장소 추가"(맛집·카페 등) — 카테고리 필터 없이 전체 카테고리에서 검색.
    // searchAccommodation()과 파싱 로직이 완전히 동일해 공통 search()로 통합, 카테고리 유무만 다르다.
    public List<KakaoPlaceDto> searchPlace(String keyword) {
        return search(keyword, null);
    }

    private List<KakaoPlaceDto> search(String keyword, String categoryGroupCode) {
        String encoded = URLEncoder.encode(keyword, StandardCharsets.UTF_8);
        String url = BASE_URL + "/search/keyword.json?query=" + encoded;
        if (categoryGroupCode != null) {
            url += "&category_group_code=" + categoryGroupCode;
        }
        JsonNode root = get(URI.create(url));

        List<KakaoPlaceDto> results = new ArrayList<>();
        for (JsonNode doc : root.path("documents")) {
            // 좌표 없는 결과는 방어적으로 스킵
            if (doc.path("x").isMissingNode() || doc.path("y").isMissingNode()) {
                continue;
            }
            double lng = doc.path("x").asDouble();
            double lat = doc.path("y").asDouble();
            String roadAddress = doc.path("road_address_name").asText("");
            String address = !roadAddress.isBlank() ? roadAddress : doc.path("address_name").asText(null);
            results.add(new KakaoPlaceDto(doc.path("place_name").asText(), address, lat, lng));
        }
        return results;
    }

    // 지도 핀 선택 fallback용 — 좌표 → 주소 문자열
    public String reverseGeocode(double lat, double lng) {
        URI uri = URI.create(BASE_URL + "/geo/coord2address.json?x=" + lng + "&y=" + lat);
        JsonNode docs = get(uri).path("documents");
        if (!docs.isArray() || docs.isEmpty()) {
            return null;
        }
        JsonNode doc = docs.get(0);
        JsonNode roadAddress = doc.path("road_address");
        if (!roadAddress.isMissingNode() && !roadAddress.isNull()) {
            return roadAddress.path("address_name").asText(null);
        }
        return doc.path("address").path("address_name").asText(null);
    }

    private JsonNode get(URI uri) {
        if (kakaoRestApiKey == null || kakaoRestApiKey.isBlank()) {
            log.error("카카오 REST API 키 미설정 — KAKAO_REST_API_KEY 확인 필요");
            throw new BusinessException(ErrorCode.KAKAO_API_ERROR);
        }
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(uri)
                    .header("Authorization", "KakaoAK " + kakaoRestApiKey)
                    .GET()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 400) {
                log.error("카카오 API 오류: status={}, body={}", response.statusCode(), response.body());
                throw new BusinessException(ErrorCode.KAKAO_API_ERROR);
            }
            return objectMapper.readTree(response.body());
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("카카오 API 호출 실패: {}", e.getMessage());
            throw new BusinessException(ErrorCode.KAKAO_API_ERROR);
        }
    }
}

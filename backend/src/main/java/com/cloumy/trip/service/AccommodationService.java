package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.AccommodationCreateRequest;
import com.cloumy.trip.dto.AccommodationResponse;
import com.cloumy.trip.dto.KakaoPlaceDto;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.AccommodationRepository;
import com.cloumy.trip.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AccommodationService {

    private final AccommodationRepository accommodationRepository;
    private final RouteRepository routeRepository;
    private final KakaoLocalClient kakaoLocalClient;

    // 검색만 — DB 저장 없음
    public List<KakaoPlaceDto> search(String keyword) {
        return kakaoLocalClient.searchAccommodation(keyword);
    }

    // 지도 핀 선택 fallback용 — 좌표 -> 주소 문자열 (실패 시 null, 컨트롤러가 그대로 전달)
    public String reverseGeocode(double lat, double lng) {
        return kakaoLocalClient.reverseGeocode(lat, lng);
    }

    @Transactional
    public AccommodationResponse create(UUID routeId, UUID userId, AccommodationCreateRequest req) {
        verifyOwner(routeId, userId);
        if (!req.checkOutDate().isAfter(req.checkInDate())) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "체크아웃 날짜는 체크인 날짜 이후여야 합니다");
        }

        UUID id = UUID.randomUUID();
        accommodationRepository.insertWithLocation(
                id, routeId, req.name(), req.address(),
                req.lng(), req.lat(), req.checkInDate(), req.checkOutDate(), req.source()
        );

        return accommodationRepository.findByRouteId(routeId).stream()
                .filter(p -> p.getId().equals(id.toString()))
                .findFirst()
                .map(AccommodationResponse::from)
                .orElseThrow(() -> new BusinessException(ErrorCode.ACCOMMODATION_NOT_FOUND));
    }

    public List<AccommodationResponse> getByRoute(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        return accommodationRepository.findByRouteId(routeId).stream()
                .map(AccommodationResponse::from)
                .toList();
    }

    @Transactional
    public void delete(UUID routeId, UUID accommodationId, UUID userId) {
        verifyOwner(routeId, userId);
        boolean belongsToRoute = accommodationRepository.findByRouteId(routeId).stream()
                .anyMatch(p -> p.getId().equals(accommodationId.toString()));
        if (!belongsToRoute) {
            throw new BusinessException(ErrorCode.ACCOMMODATION_NOT_FOUND);
        }
        accommodationRepository.deleteById(accommodationId);
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

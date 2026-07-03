package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.payment.service.PassValidationService;
import com.cloumy.trip.dto.AccommodationCreateRequest;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.AccommodationRepository;
import com.cloumy.trip.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteService {

    private final PassValidationService passValidationService;
    private final RouteRepository routeRepository;
    private final AccommodationRepository accommodationRepository;

    public Page<RouteListResponse> getMyRoutes(UUID userId, Pageable pageable) {
        return routeRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(r -> new RouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(),
                        r.getStartDate(), r.getEndDate(), r.getNights(),
                        r.getCreatedAt()
                ));
    }

    public RouteListResponse getRoute(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        return new RouteListResponse(
                route.getId(), route.getTitle(), route.getDestination(),
                route.getStartDate(), route.getEndDate(), route.getNights(),
                route.getCreatedAt()
        );
    }

    @Transactional
    public Route createRoute(RouteGenRequest req, UUID userId) {
        passValidationService.validate(userId);

        String title = req.destination() + " " + req.nights() + "박 여행";
        String[] tags = req.tags() != null ? req.tags().toArray(new String[0]) : new String[]{};

        Route route = Route.builder()
                .userId(userId)
                .title(title)
                .destination(req.destination())
                .startDate(req.startDate())
                .endDate(req.endDate())
                .nights(req.nights())
                .groupType(req.groupType().toLowerCase())
                .budgetLevel(req.budgetLevel().toLowerCase())
                .tags(tags)
                .density(req.density() != null ? req.density().toLowerCase() : "normal")
                .transportMode(req.transportMode() != null ? req.transportMode().toLowerCase() : null)
                .build();

        Route saved = routeRepository.save(route);

        // 숙소는 Route가 만들어진 뒤에만 route_id(FK)를 가질 수 있어 여기서 같이 저장한다.
        // 메서드 전체가 @Transactional이라 숙소 저장 실패 시 Route 생성까지 롤백된다.
        for (AccommodationCreateRequest acc : req.accommodationsOrEmpty()) {
            if (!acc.checkOutDate().isAfter(acc.checkInDate())) {
                throw new BusinessException(ErrorCode.INVALID_INPUT, "체크아웃 날짜는 체크인 날짜 이후여야 합니다");
            }
            accommodationRepository.insertWithLocation(
                    UUID.randomUUID(), saved.getId(), acc.name(), acc.address(),
                    acc.lng(), acc.lat(), acc.checkInDate(), acc.checkOutDate(), acc.source()
            );
        }

        return saved;
    }

    @Transactional
    public void deleteRoute(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        routeRepository.delete(route);
    }
}

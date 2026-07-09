package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.payment.service.PassValidationService;
import com.cloumy.trip.dto.AccommodationCreateRequest;
import com.cloumy.trip.dto.PublicRouteListResponse;
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

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteService {

    private final PassValidationService passValidationService;
    private final RouteRepository routeRepository;
    private final AccommodationRepository accommodationRepository;
    private final BudgetSettingsService budgetSettingsService;

    public Page<RouteListResponse> getMyRoutes(UUID userId, Pageable pageable) {
        return routeRepository.findByUserIdOrderByDisplayOrderAsc(userId, pageable)
                .map(r -> new RouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(),
                        r.getStartDate(), r.getEndDate(), r.getNights(),
                        r.getCreatedAt(), r.isPublic()
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
                route.getCreatedAt(), route.isPublic()
        );
    }

    @Transactional
    public Route createRoute(RouteGenRequest req, UUID userId) {
        passValidationService.validate(userId);

        String title = req.destination() + " " + req.nights() + "박 여행";
        String[] tags = req.tags() != null ? req.tags().toArray(new String[0]) : new String[]{};
        int displayOrder = routeRepository.findMinDisplayOrder(userId) - 1;

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
                .displayOrder(displayOrder)
                .build();

        Route saved = routeRepository.save(route);

        // totalBudget 선택 사항 — 숙소와 동일하게 없으면 예산 기능 자체를 건너뜀
        if (req.totalBudget() != null) {
            budgetSettingsService.createDefault(saved.getId(), req.totalBudget(), req.tags());
        }

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
    public void updateVisibility(UUID routeId, UUID userId, boolean isPublic) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        route.updateVisibility(isPublic);
    }

    // 공유 루트 가져오기 — 소유자 검증 없음(공개 열람이므로), 요청자 본인 루트는 자동 제외
    public Page<PublicRouteListResponse> getPublicRoutes(String destination, UUID requesterId, Pageable pageable) {
        return routeRepository.findByDestinationAndIsPublicTrueAndUserIdNot(destination, requesterId, pageable)
                .map(r -> new PublicRouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(), r.getNights(), r.getTags(), r.getSaveCount()
                ));
    }

    // fixedSlots를 가져온 원본 루트들의 save_count 증가 — 존재하지 않는 id는 findAllById가
    // 조용히 걸러줘서 별도 예외 처리 불필요(실패해도 루트 생성 자체는 이미 끝난 뒤라 영향 없음)
    @Transactional
    public void incrementSaveCounts(List<UUID> routeIds) {
        routeRepository.findAllById(routeIds).forEach(Route::incrementSaveCount);
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

    @Transactional
    public List<RouteListResponse> reorderRoutes(UUID userId, List<UUID> routeIds) {
        List<Route> routes = routeRepository.findAllById(routeIds);

        if (routes.size() != routeIds.size()) {
            throw new BusinessException(ErrorCode.ROUTE_NOT_FOUND);
        }
        for (Route route : routes) {
            if (!route.getUserId().equals(userId)) {
                throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
            }
        }

        for (int i = 0; i < routeIds.size(); i++) {
            UUID targetId = routeIds.get(i);
            int newOrder = i;
            routes.stream()
                    .filter(r -> r.getId().equals(targetId))
                    .findFirst()
                    .ifPresent(r -> r.updateDisplayOrder(newOrder));
        }

        return routeRepository.findByUserIdOrderByDisplayOrderAsc(userId)
                .stream()
                .map(r -> new RouteListResponse(
                        r.getId(), r.getTitle(), r.getDestination(),
                        r.getStartDate(), r.getEndDate(), r.getNights(),
                        r.getCreatedAt(), r.isPublic()
                ))
                .toList();
    }
}

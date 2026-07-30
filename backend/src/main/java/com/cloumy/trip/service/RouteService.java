package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.payment.service.PassValidationService;
import com.cloumy.trip.dto.AccommodationCreateRequest;
import com.cloumy.trip.dto.ActiveRouteResponse;
import com.cloumy.trip.dto.ManualRouteCreateRequest;
import com.cloumy.trip.dto.PublicRouteResponse;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.dto.RouteListResponse;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.entity.RouteBookmark;
import com.cloumy.trip.repository.AccommodationRepository;
import com.cloumy.trip.repository.RouteBookmarkRepository;
import com.cloumy.trip.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteService {

    private final PassValidationService passValidationService;
    private final RouteRepository routeRepository;
    private final RouteBookmarkRepository routeBookmarkRepository;
    private final AccommodationRepository accommodationRepository;
    private final BudgetSettingsService budgetSettingsService;
    private final PersonaTagAutoAssignService personaTagAutoAssignService;
    private final RouteSlotService routeSlotService;

    public Page<RouteListResponse> getMyRoutes(UUID userId, Pageable pageable) {
        return routeRepository.findByUserIdOrderByDisplayOrderAsc(userId, pageable)
                .map(this::toListResponse);
    }

    public RouteListResponse getRoute(UUID routeId, UUID userId) {
        Route route = findOwned(routeId, userId);
        return toListResponse(route);
    }

    // 프로액티브 T1(출국 준비) 전제 — 선택 입력, null로 다시 지울 수도 있다(미입력 상태로 되돌림)
    @Transactional
    public void updateDepartureAt(UUID routeId, UUID userId, OffsetDateTime departureAt) {
        Route route = findOwned(routeId, userId);
        route.updateDepartureAt(departureAt);
    }

    // RETURN_DEPARTURE 규칙 전제 — 선택 입력. 오는 편이 가는 편보다 이르면 사용자 실수다 —
    // 알림 시각이 과거로 계산돼 영원히 안 뜬다
    @Transactional
    public void updateReturnAt(UUID routeId, UUID userId, OffsetDateTime returnAt) {
        Route route = findOwned(routeId, userId);
        if (returnAt != null && route.getDepartureAt() != null
                && returnAt.isBefore(route.getDepartureAt())) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "오는 편은 가는 편보다 늦어야 합니다");
        }
        route.updateReturnAt(returnAt);
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
        personaTagAutoAssignService.checkAndAssign(userId);

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

    // 공유 루트 가져오기 — 공개 토글은 소유자만 가능
    @Transactional
    public void updateVisibility(UUID routeId, UUID userId, boolean isPublic) {
        Route route = findOwned(routeId, userId);
        route.updateVisibility(isPublic);
    }

    // 공유 루트 가져오기 — 목적지 일치 공개 루트 브라우징. 소유자 검증 없음(공개 열람이므로),
    // 요청자 본인 루트는 제외
    // 루트/커뮤니티 탭 신설 — destination이 없으면 목적지 무관 전체 공개 루트 피드로 분기
    public Page<PublicRouteResponse> getPublicRoutes(
            String destination, boolean bookmarkedOnly, UUID requesterId, Pageable pageable) {
        return routeRepository.findPublicRoutes(destination, requesterId, bookmarkedOnly, pageable)
                .map(PublicRouteResponse::from);
    }

    @Transactional
    public void addRouteBookmark(UUID userId, UUID routeId) {
        if (!routeBookmarkRepository.existsByUserIdAndRouteId(userId, routeId)) {
            routeBookmarkRepository.save(RouteBookmark.builder().userId(userId).routeId(routeId).build());
        }
    }

    @Transactional
    public void removeRouteBookmark(UUID userId, UUID routeId) {
        routeBookmarkRepository.deleteByUserIdAndRouteId(userId, routeId);
    }

    // 루트/커뮤니티 탭 신설 — 공개 루트 전체 복제. 박수는 원본 그대로 고정하고 시작일만 새로 받는다
    // (day_number가 원본 박수 기준으로 확정돼 있어 새 박수를 자유롭게 받으면 슬롯을 잘라내거나
    // 뭉개는 클램핑이 필요해짐 — 시작일만 받으면 구조를 그대로 보존하면서 "과거 여행 날짜 그대로
    // 복사되는 문제"도 해결됨)
    @Transactional
    public RouteListResponse cloneRoute(UUID routeId, UUID userId, LocalDate startDate) {
        Route original = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!original.isPublic()) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }

        LocalDate endDate = startDate.plusDays(original.getNights());
        int displayOrder = routeRepository.findMinDisplayOrder(userId) - 1;

        Route cloned = Route.builder()
                .userId(userId)
                .title(original.getTitle())
                .destination(original.getDestination())
                .startDate(startDate)
                .endDate(endDate)
                .nights(original.getNights())
                .groupType(original.getGroupType())
                .budgetLevel(original.getBudgetLevel())
                .tags(original.getTags())
                .density(original.getDensity())
                .displayOrder(displayOrder)
                .build();
        Route saved = routeRepository.save(cloned);

        routeSlotService.cloneSlots(routeId, saved.getId());
        original.incrementSaveCount();

        return toListResponse(saved);
    }

    // 루트/커뮤니티 탭 신설 — 수동 작성 폼 제출 시 즉시 공개 루트로 생성
    // (groupType/budgetLevel/density는 폼에 없는 항목이라 내부 기본값 고정 — createRoute()의
    // density 기본값 "normal"과 같은 관례)
    @Transactional
    public RouteListResponse createManualRoute(ManualRouteCreateRequest req, UUID userId) {
        if (!req.endDate().isAfter(req.startDate())) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "종료일은 시작일 이후여야 합니다");
        }
        int nights = (int) ChronoUnit.DAYS.between(req.startDate(), req.endDate());
        int displayOrder = routeRepository.findMinDisplayOrder(userId) - 1;

        Route route = Route.builder()
                .userId(userId)
                .title(req.title())
                .destination(req.destination())
                .startDate(req.startDate())
                .endDate(req.endDate())
                .nights(nights)
                .groupType("solo")
                .budgetLevel("mid")
                .tags(new String[]{})
                .density("normal")
                .displayOrder(displayOrder)
                .build();
        Route saved = routeRepository.save(route);
        saved.updateVisibility(true);

        routeSlotService.createManualSlots(saved.getId(), req.slots());

        return toListResponse(saved);
    }

    // 공유 루트 가져오기 — 새 루트 생성 성공 후 가져온 원본 루트들의 save_count 증가.
    // 존재하지 않는(이미 삭제된) routeId는 findAllById가 조용히 걸러내 스킵된다 —
    // 카운트 실패가 루트 생성 자체를 막을 이유는 없음.
    @Transactional
    public void incrementSaveCounts(List<UUID> routeIds) {
        if (routeIds.isEmpty()) {
            return;
        }
        routeRepository.findAllById(routeIds).forEach(Route::incrementSaveCount);
    }

    @Transactional
    public void deleteRoute(UUID routeId, UUID userId) {
        Route route = findOwned(routeId, userId);
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
                .map(this::toListResponse)
                .toList();
    }

    // 활성 루트 판정 — "지금 도와줄 여행이 무엇인가"를 목록 정렬(display_order)이 아니라
    // 날짜 기준으로 직접 고른다. 진행 중이 있으면 그걸 쓰고, 없을 때만 다가올 여행을 조회한다
    // (진행 중이 있는데도 두 번째 쿼리를 매번 날릴 이유가 없다).
    public ActiveRouteResponse getActiveRoute(UUID userId) {
        // AI의 _KST와 같은 이유로 명시 — 도커 컨테이너는 UTC라 LocalDate.now()만 쓰면 자정 근처에 하루 어긋난다
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        Pageable one = PageRequest.of(0, 1);

        List<Route> ongoing = routeRepository.findOngoing(userId, today, one);
        List<Route> found = ongoing.isEmpty() ? routeRepository.findUpcoming(userId, today, one) : ongoing;

        return new ActiveRouteResponse(found.isEmpty() ? null : toListResponse(found.get(0)));
    }

    // new RouteListResponse(...) 5곳 중복 제거용 헬퍼
    private RouteListResponse toListResponse(Route r) {
        return new RouteListResponse(
                r.getId(), r.getTitle(), r.getDestination(),
                r.getStartDate(), r.getEndDate(), r.getNights(),
                r.getCreatedAt(), r.isPublic(), r.getDepartureAt(), r.getReturnAt()
        );
    }

    // 소유권 검증(findById + ROUTE_NOT_FOUND + userId 비교 + ROUTE_ACCESS_DENIED) 중복 제거용 헬퍼.
    // cloneRoute(공개 여부 검사)와 reorderRoutes(루프 안에서 여러 건 검증)는 성격이 달라 대상에서 제외.
    private Route findOwned(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
        return route;
    }
}

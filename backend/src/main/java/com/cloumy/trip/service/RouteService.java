package com.cloumy.trip.service;

import com.cloumy.payment.service.PassValidationService;
import com.cloumy.trip.dto.RouteGenRequest;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteService {

    private final PassValidationService passValidationService;
    private final RouteRepository routeRepository;

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
                .groupType(req.groupType())
                .budgetLevel(req.budgetLevel())
                .tags(tags)
                .build();

        return routeRepository.save(route);
    }
}

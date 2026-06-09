package com.cloumy.trip.service;

import com.cloumy.payment.service.PassValidationService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class RouteService {

    private final PassValidationService passValidationService;

    @Transactional
    public void saveRoute(UUID userId) {
        passValidationService.validate(userId);

        // TODO: 루트 저장 로직 구현 (별도 태스크)
    }
}

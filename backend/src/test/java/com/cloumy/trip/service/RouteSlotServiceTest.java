package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.entity.RouteSlot;
import com.cloumy.trip.repository.PlaceRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RouteSlotServiceTest {

    @Mock
    private RouteRepository routeRepository;

    @Mock
    private RouteSlotRepository routeSlotRepository;

    @Mock
    private PlaceRepository placeRepository;

    @Mock
    private RouteDaySummaryService routeDaySummaryService;

    @Mock
    private AiServiceClient aiServiceClient;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private RouteSlotService routeSlotService;

    private PlaceProjection stubPlace(UUID placeId) {
        return new PlaceProjection() {
            @Override
            public String getId() {
                return placeId.toString();
            }

            @Override
            public String getName() {
                return "테스트 카페";
            }

            @Override
            public String getAddress() {
                return "서울 종로구";
            }

            @Override
            public Double getLat() {
                return 37.5;
            }

            @Override
            public Double getLng() {
                return 127.0;
            }

            @Override
            public Integer getAvgDurationMinutes() {
                return 60;
            }

            @Override
            public Boolean getIsHiddenGem() {
                return false;
            }

            @Override
            public Boolean getIsCurated() {
                return true;
            }

            @Override
            public String getNameEn() {
                return "Test Cafe";
            }

            @Override
            public String[] getCategoryTags() {
                return new String[]{"#카페"};
            }
        };
    }

    @Test
    void insertSlotAfterWithNullAnchorInsertsAtHeadAndShiftsExistingSlots() {
        UUID routeId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();

        Route route = Route.builder().userId(userId).nights(2).build();

        // 이미 day 1에 있는 슬롯 두 개(orderIndex 0, 1) — null 앵커 삽입 시 전부 +1씩 밀려야 한다.
        RouteSlot existing0 = RouteSlot.builder()
                .routeId(routeId).placeId(UUID.randomUUID()).dayNumber(1).orderIndex(0).build();
        RouteSlot existing1 = RouteSlot.builder()
                .routeId(routeId).placeId(UUID.randomUUID()).dayNumber(1).orderIndex(1).build();

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(route));
        when(placeRepository.findPlaceDetailById(any())).thenReturn(Optional.of(stubPlace(placeId)));
        // afterSlotId가 null이면 insertOrderIndex=0 — 원래 그 자리에 있던 첫 슬롯이 "next"가 된다.
        when(routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndex(routeId, 1, 0))
                .thenReturn(Optional.of(existing0));
        // shiftFrom=-1 → orderIndex > -1 조건이 되어 그 Day 전체(0, 1)가 밀림 대상 — 내림차순 반환
        when(routeSlotRepository.findByRouteIdAndDayNumberAndOrderIndexGreaterThanOrderByOrderIndexDesc(
                routeId, 1, -1))
                .thenReturn(List.of(existing1, existing0));
        when(aiServiceClient.getSlotTransport(any())).thenReturn(List.of(
                new AiServiceClient.TransportSlotResult(placeId.toString(), null, null, null, null),
                new AiServiceClient.TransportSlotResult(placeId.toString(), null, null, null, null)
        ));
        when(routeSlotRepository.findByRouteIdAndDayNumberOrderByOrderIndex(routeId, 1)).thenReturn(List.of());
        when(routeSlotRepository.findSlotsByRouteId(routeId)).thenReturn(List.of());

        routeSlotService.insertSlotAfter(routeId, userId, null, 1, placeId, "카페 들르기");

        assertThat(existing0.getOrderIndex()).isEqualTo(1);
        assertThat(existing1.getOrderIndex()).isEqualTo(2);

        ArgumentCaptor<RouteSlot> captor = ArgumentCaptor.forClass(RouteSlot.class);
        verify(routeSlotRepository).save(captor.capture());
        assertThat(captor.getValue().getOrderIndex()).isEqualTo(0);
        assertThat(captor.getValue().getDayNumber()).isEqualTo(1);
    }

    @Test
    void insertSlotAfterRejectsAnchorFromAnotherRoute() {
        UUID routeId = UUID.randomUUID();
        UUID otherRouteId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();
        UUID foreignSlotId = UUID.randomUUID();

        Route route = Route.builder().userId(userId).nights(2).build();
        // 다른 루트 소속 슬롯 — routeId가 이 요청의 routeId와 다르다.
        RouteSlot foreignSlot = RouteSlot.builder()
                .routeId(otherRouteId).placeId(UUID.randomUUID()).dayNumber(1).orderIndex(0).build();

        when(routeRepository.findById(routeId)).thenReturn(Optional.of(route));
        when(routeSlotRepository.findById(foreignSlotId)).thenReturn(Optional.of(foreignSlot));

        assertThatThrownBy(() -> routeSlotService.insertSlotAfter(
                routeId, userId, foreignSlotId, 1, placeId, null))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> {
                    BusinessException ex = (BusinessException) e;
                    assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.SLOT_NOT_FOUND);
                });
    }
}

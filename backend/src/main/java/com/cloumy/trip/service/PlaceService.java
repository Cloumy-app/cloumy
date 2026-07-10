package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.ExternalPlaceRequest;
import com.cloumy.trip.dto.KakaoPlaceDto;
import com.cloumy.trip.dto.PlaceDetailResponse;
import com.cloumy.trip.repository.PlaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class PlaceService {

    // 외부/수동 장소 find-or-create dedup 반경(미터) — 스펙에서 결정한 값
    private static final int EXTERNAL_PLACE_DEDUP_RADIUS_M = 50;

    private final PlaceRepository placeRepository;
    private final KakaoLocalClient kakaoLocalClient;

    public PlaceDetailResponse getPlaceDetail(UUID placeId) {
        return placeRepository.findPlaceDetailById(placeId)
                .map(PlaceDetailResponse::from)
                .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
    }

    // "직접 장소 추가" — 카테고리 필터 없는 일반 카카오 검색(AccommodationService와 동일한
    // 컨트롤러→서비스→KakaoLocalClient 3단 구조)
    public List<KakaoPlaceDto> searchPlaces(String keyword) {
        return kakaoLocalClient.searchPlace(keyword);
    }

    // find-or-create — 반경 50m + 이름 일치하는 기존 place가 있으면 재사용, 없으면 최소 정보로
    // 신규 생성(is_curated=false). 동시 요청으로 인한 드문 중복 생성은 이 스케일에서 수용한다.
    @Transactional
    public UUID resolveExternalPlace(ExternalPlaceRequest req) {
        String normalizedName = req.name().trim().toLowerCase();
        Optional<String> existingId = placeRepository.findNearbyPlaceIdByName(
                req.lng(), req.lat(), EXTERNAL_PLACE_DEDUP_RADIUS_M, normalizedName);
        if (existingId.isPresent()) {
            return UUID.fromString(existingId.get());
        }

        UUID newId = UUID.randomUUID();
        placeRepository.insertMinimal(newId, req.name(), req.address(), req.lng(), req.lat(), req.source());
        return newId;
    }
}

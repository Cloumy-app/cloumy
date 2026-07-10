package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.constant.CityCenters;
import com.cloumy.trip.dto.PlaceBrowseResponse;
import com.cloumy.trip.dto.PlaceProjection;
import com.cloumy.trip.entity.Bookmark;
import com.cloumy.trip.repository.BookmarkRepository;
import com.cloumy.trip.repository.PlaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ExploreService {

    private final PlaceRepository placeRepository;
    private final BookmarkRepository bookmarkRepository;

    public Page<PlaceBrowseResponse> browsePlaces(String city, List<String> tags, UUID userId, Pageable pageable) {
        double[] coords = CityCenters.COORDS.get(city);
        if (coords == null) {
            throw new BusinessException(ErrorCode.INVALID_CITY);
        }
        // places.category_tags는 항상 "#"로 시작(예: #맛집)하는데 프론트(테마 선택)는 "#" 없이
        // 넘긴다 — ai/app/services/retrievers.py의 PostgisTagRetriever와 동일한 정규화 필요.
        String tagsCsv = tags == null ? "" : tags.stream()
                .map(t -> t.startsWith("#") ? t : "#" + t)
                .collect(Collectors.joining(","));
        return placeRepository.browsePlaces(coords[0], coords[1], tagsCsv, userId, pageable)
                .map(PlaceBrowseResponse::from);
    }

    @Transactional
    public void addBookmark(UUID userId, UUID placeId) {
        if (!bookmarkRepository.existsByUserIdAndPlaceId(userId, placeId)) {
            bookmarkRepository.save(Bookmark.builder().userId(userId).placeId(placeId).build());
        }
    }

    @Transactional
    public void removeBookmark(UUID userId, UUID placeId) {
        bookmarkRepository.deleteByUserIdAndPlaceId(userId, placeId);
    }

    // 유저당 북마크는 많아야 수십~수백 건이라 장소별 개별 조회(N+1)를 이 스케일에선 허용한다.
    // routes 목록 등 기존 코드도 동일 스케일 가정 하에 같은 패턴을 쓴다.
    public Page<PlaceBrowseResponse> getMyBookmarks(UUID userId, Pageable pageable) {
        return bookmarkRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(bookmark -> {
                    PlaceProjection p = placeRepository.findPlaceDetailById(bookmark.getPlaceId())
                            .orElseThrow(() -> new BusinessException(ErrorCode.PLACE_NOT_FOUND));
                    return new PlaceBrowseResponse(
                            UUID.fromString(p.getId()),
                            p.getName(),
                            p.getAddress(),
                            p.getLat() != null ? p.getLat() : 0,
                            p.getLng() != null ? p.getLng() : 0,
                            p.getCategoryTags() != null ? List.of(p.getCategoryTags()) : List.of(),
                            Boolean.TRUE.equals(p.getIsHiddenGem()),
                            true
                    );
                });
    }
}

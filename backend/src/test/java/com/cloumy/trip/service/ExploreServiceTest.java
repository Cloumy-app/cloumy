package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.PlaceBrowseProjection;
import com.cloumy.trip.entity.Bookmark;
import com.cloumy.trip.repository.BookmarkRepository;
import com.cloumy.trip.repository.PlaceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ExploreServiceTest {

    @Mock
    private PlaceRepository placeRepository;

    @Mock
    private BookmarkRepository bookmarkRepository;

    @InjectMocks
    private ExploreService exploreService;

    private PlaceBrowseProjection stubProjection(UUID placeId) {
        return new PlaceBrowseProjection() {
            @Override
            public String getId() {
                return placeId.toString();
            }

            @Override
            public String getName() {
                return "테스트 장소";
            }

            @Override
            public String getAddress() {
                return "서울 어딘가";
            }

            @Override
            public Double getLat() {
                return 37.5665;
            }

            @Override
            public Double getLng() {
                return 126.9780;
            }

            @Override
            public String[] getCategoryTags() {
                return new String[]{"#맛집"};
            }

            @Override
            public Boolean getIsHiddenGem() {
                return false;
            }

            @Override
            public Boolean getIsBookmarked() {
                return false;
            }
        };
    }

    @Test
    void browsePlacesReturnsMappedPageForValidCity() {
        UUID userId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();
        Pageable pageable = Pageable.ofSize(50);
        when(placeRepository.browsePlaces(anyDouble(), anyDouble(), anyString(), eq(userId), eq(pageable)))
                .thenReturn(new PageImpl<>(List.of(stubProjection(placeId))));

        Page<?> result = exploreService.browsePlaces("서울", List.of("맛집"), userId, pageable);

        assertThat(result.getContent()).hasSize(1);
    }

    @Test
    void browsePlacesThrowsForUnknownCity() {
        UUID userId = UUID.randomUUID();
        Pageable pageable = Pageable.ofSize(50);

        assertThatThrownBy(() -> exploreService.browsePlaces("평양", List.of(), userId, pageable))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> {
                    BusinessException ex = (BusinessException) e;
                    assertThat(ex.getErrorCode()).isEqualTo(ErrorCode.INVALID_CITY);
                });
    }

    @Test
    void addBookmarkSkipsWhenAlreadyBookmarked() {
        UUID userId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();
        when(bookmarkRepository.existsByUserIdAndPlaceId(userId, placeId)).thenReturn(true);

        exploreService.addBookmark(userId, placeId);

        verify(bookmarkRepository, never()).save(any(Bookmark.class));
    }

    @Test
    void addBookmarkSavesWhenNotYetBookmarked() {
        UUID userId = UUID.randomUUID();
        UUID placeId = UUID.randomUUID();
        when(bookmarkRepository.existsByUserIdAndPlaceId(userId, placeId)).thenReturn(false);

        exploreService.addBookmark(userId, placeId);

        verify(bookmarkRepository, times(1)).save(any(Bookmark.class));
    }
}

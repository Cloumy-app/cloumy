package com.cloumy.trip.repository;

import com.cloumy.trip.entity.Bookmark;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface BookmarkRepository extends JpaRepository<Bookmark, UUID> {

    boolean existsByUserIdAndPlaceId(UUID userId, UUID placeId);

    void deleteByUserIdAndPlaceId(UUID userId, UUID placeId);

    Page<Bookmark> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);
}

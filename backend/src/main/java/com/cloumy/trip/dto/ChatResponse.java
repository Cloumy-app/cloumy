package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.util.List;

public record ChatResponse(
        String reply,
        List<ChatPlaceCard> places,
        @JsonAlias("estimated_slot") ChatEstimatedSlot estimatedSlot,
        ChatInsertion insertion
) {}

package com.cloumy.trip.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

public record ChatEstimatedSlot(
        @JsonAlias("slot_id") String slotId,
        int day,
        @JsonAlias("order_index") int orderIndex
) {}

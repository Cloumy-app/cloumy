package com.cloumy.trip.dto;

import com.cloumy.trip.entity.Expense;

import java.time.LocalDateTime;
import java.util.UUID;

public record ExpenseResponse(
        UUID id,
        String category,
        int actualAmount,
        String memo,
        LocalDateTime createdAt
) {
    public static ExpenseResponse from(Expense e) {
        return new ExpenseResponse(e.getId(), e.getCategory(), e.getActualAmount(), e.getMemo(), e.getCreatedAt());
    }
}

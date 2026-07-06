package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record AddExpenseRequest(
        @NotBlank @Pattern(regexp = "식음료|교통|입장료|기념품|기타") String category,
        @NotNull @Min(0) Integer actualAmount,
        String memo
) {}

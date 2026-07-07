package com.cloumy.trip.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record AddExpenseRequest(
        @NotBlank @Pattern(regexp = "FOOD|TRANSPORT|ADMISSION|SOUVENIR|ETC") String category,
        @NotNull @Min(0) Integer actualAmount,
        String memo
) {}

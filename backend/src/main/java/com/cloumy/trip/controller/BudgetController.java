package com.cloumy.trip.controller;

import com.cloumy.auth.security.CloudmyUserDetails;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.trip.dto.AddExpenseRequest;
import com.cloumy.trip.dto.BudgetReportResponse;
import com.cloumy.trip.dto.BudgetSummaryResponse;
import com.cloumy.trip.dto.ExpenseResponse;
import com.cloumy.trip.dto.UpdateRatiosRequest;
import com.cloumy.trip.service.BudgetSettingsService;
import com.cloumy.trip.service.ExpenseService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/routes/{routeId}")
@RequiredArgsConstructor
public class BudgetController {

    private final BudgetSettingsService budgetSettingsService;
    private final ExpenseService expenseService;

    @GetMapping("/budget-settings")
    public ApiResponse<BudgetSummaryResponse> getSummary(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(budgetSettingsService.getSummary(routeId, UUID.fromString(user.userId())));
    }

    @PatchMapping("/budget-settings/ratios")
    public ApiResponse<BudgetSummaryResponse> updateRatios(
            @PathVariable UUID routeId,
            @RequestBody @Valid UpdateRatiosRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(budgetSettingsService.updateRatios(routeId, UUID.fromString(user.userId()), req));
    }

    @GetMapping("/expenses")
    public ApiResponse<List<ExpenseResponse>> getExpenses(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(expenseService.getExpenses(routeId, UUID.fromString(user.userId())));
    }

    @PostMapping("/expenses")
    public ApiResponse<ExpenseResponse> addExpense(
            @PathVariable UUID routeId,
            @RequestBody @Valid AddExpenseRequest req,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(expenseService.addExpense(routeId, UUID.fromString(user.userId()), req));
    }

    @DeleteMapping("/expenses/{expenseId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteExpense(
            @PathVariable UUID routeId,
            @PathVariable UUID expenseId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        expenseService.deleteExpense(routeId, expenseId, UUID.fromString(user.userId()));
    }

    @GetMapping("/budget-report")
    public ApiResponse<BudgetReportResponse> getReport(
            @PathVariable UUID routeId,
            @AuthenticationPrincipal CloudmyUserDetails user
    ) {
        return ApiResponse.ok(expenseService.getReport(routeId, UUID.fromString(user.userId())));
    }
}

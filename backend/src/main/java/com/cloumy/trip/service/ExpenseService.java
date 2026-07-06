package com.cloumy.trip.service;

import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import com.cloumy.trip.dto.AddExpenseRequest;
import com.cloumy.trip.dto.BudgetReportResponse;
import com.cloumy.trip.dto.ExpenseResponse;
import com.cloumy.trip.entity.Expense;
import com.cloumy.trip.entity.Route;
import com.cloumy.trip.repository.ExpenseRepository;
import com.cloumy.trip.repository.RouteRepository;
import com.cloumy.trip.repository.RouteSlotRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ExpenseService {

    private final RouteRepository routeRepository;
    private final ExpenseRepository expenseRepository;
    private final RouteSlotRepository routeSlotRepository;

    public List<ExpenseResponse> getExpenses(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        return expenseRepository.findByRouteIdOrderByCreatedAtDesc(routeId).stream()
                .map(ExpenseResponse::from)
                .toList();
    }

    @Transactional
    public ExpenseResponse addExpense(UUID routeId, UUID userId, AddExpenseRequest req) {
        verifyOwner(routeId, userId);
        Expense expense = Expense.builder()
                .routeId(routeId)
                .userId(userId)
                .category(req.category())
                .actualAmount(req.actualAmount())
                .memo(req.memo())
                .build();
        return ExpenseResponse.from(expenseRepository.save(expense));
    }

    @Transactional
    public void deleteExpense(UUID routeId, UUID expenseId, UUID userId) {
        verifyOwner(routeId, userId);
        Expense expense = expenseRepository.findById(expenseId)
                .filter(e -> e.getRouteId().equals(routeId))
                .orElseThrow(() -> new BusinessException(ErrorCode.EXPENSE_NOT_FOUND));
        expenseRepository.delete(expense);
    }

    public BudgetReportResponse getReport(UUID routeId, UUID userId) {
        verifyOwner(routeId, userId);
        int plannedTotal = routeSlotRepository.sumEstimatedCostByRouteId(routeId);
        List<BudgetReportResponse.CategoryTotal> categoryTotals = expenseRepository.sumByCategory(routeId)
                .stream()
                .map(p -> new BudgetReportResponse.CategoryTotal(p.getCategory(), p.getTotal()))
                .toList();
        return new BudgetReportResponse(plannedTotal, categoryTotals);
    }

    private void verifyOwner(UUID routeId, UUID userId) {
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROUTE_NOT_FOUND));
        if (!route.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.ROUTE_ACCESS_DENIED);
        }
    }
}

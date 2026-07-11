import { apiFetch } from './client';
import type { AddExpenseRequest, BudgetReport, BudgetSummary, Expense } from '@/types';

export async function getBudgetSummary(routeId: string): Promise<BudgetSummary> {
  const res = await apiFetch(`/v1/routes/${routeId}/budget-settings`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: BudgetSummary } = await res.json();
  return body.data;
}

export async function createBudget(routeId: string, totalBudget: number): Promise<BudgetSummary> {
  const res = await apiFetch(`/v1/routes/${routeId}/budget-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalBudget }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: BudgetSummary } = await res.json();
  return body.data;
}

export async function updateBudgetRatios(
  routeId: string,
  ratios: { foodRatio: number; transportRatio: number; activityRatio: number; etcRatio: number },
): Promise<BudgetSummary> {
  const res = await apiFetch(`/v1/routes/${routeId}/budget-settings/ratios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ratios),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: BudgetSummary } = await res.json();
  return body.data;
}

export async function getExpenses(routeId: string): Promise<Expense[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/expenses`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: Expense[] } = await res.json();
  return body.data;
}

export async function addExpense(routeId: string, req: AddExpenseRequest): Promise<Expense> {
  const res = await apiFetch(`/v1/routes/${routeId}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: Expense } = await res.json();
  return body.data;
}

export async function deleteExpense(routeId: string, expenseId: string): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}/expenses/${expenseId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function getBudgetReport(routeId: string): Promise<BudgetReport> {
  const res = await apiFetch(`/v1/routes/${routeId}/budget-report`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: BudgetReport } = await res.json();
  return body.data;
}

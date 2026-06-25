export interface User {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
}

export interface RouteSlot {
  day: number;
  order: number;
  place_id: string;
  place_name: string;
  tip: string;
  duration_minutes: number;
  budget_estimate: number;
  isPinned?: boolean;
}

export interface Route {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  slots: RouteSlot[];
  createdAt: string;
}

export interface RouteGenRequest {
  destination: string;
  startDate: string;
  endDate: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  tags: string[];
}

export type GroupType = 'solo' | 'couple' | 'friends' | 'family';
export type BudgetLevel = 'budget' | 'mid' | 'premium';
export type PassType = 'free' | 'basic' | 'premium';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface BudgetSummary {
  routeId: string;
  totalBudget: number;
  usedAmount: number;
  remainingAmount: number;
}

export interface Expense {
  id: string;
  routeId: string;
  description: string;
  amount: number;
  category: string;
  createdAt: string;
}

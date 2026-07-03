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

export interface RouteDaySummary {
  dayNumber: number;
  summary: string;
}

export interface RouteListItem {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  nights: number;
  createdAt: string;
}

export interface SlotWithCoords {
  id: string;
  placeId: string;
  dayNumber: number;
  orderIndex: number;
  pinned: boolean;
  startTime: string | null;
  durationMinutes: number | null;
  estimatedCost: number | null;
  transportToNext: string | null;
  transportMinutes: number | null;
  tips: string | null;
  placeName: string;
  address: string | null;
  lat: number;
  lng: number;
  avgDurationMinutes: number | null;
}

export interface PlaceDetail {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  avgDurationMinutes: number | null;
  isHiddenGem: boolean;
}

export interface SlotAlternative {
  placeName: string;
  reason: string;
  estimatedCost: number;
  lat: number;
  lng: number;
}

export interface AccommodationInput {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  checkInDate: string;
  checkOutDate: string;
  source: 'kakao' | 'manual';
}

export interface Accommodation {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  checkInDate: string;
  checkOutDate: string;
  source: 'kakao' | 'manual';
}

export type TransportMode = 'transit' | 'car' | 'walk';

export interface RouteGenRequest {
  destination: string;
  startDate: string;
  endDate: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  tags: string[];
  hiddenGemRatio?: number;
  density?: Density;
  transportMode?: TransportMode;
  accommodations?: AccommodationInput[];
}

export type GroupType = 'solo' | 'couple' | 'friends' | 'family';
export type BudgetLevel = 'tight' | 'budget' | 'mid' | 'premium' | 'luxury';
export type Density = 'relaxed' | 'normal' | 'packed';
export type PassType = 'free' | 'basic' | 'premium';
export type BudgetStatus = 'ok' | 'soft' | 'hard';

export const BUDGET_SLOT_TARGET: Record<BudgetLevel, number> = {
  tight:   4000,
  budget:  6000,
  mid:     12000,
  premium: 20000,
  luxury:  30000,
};

export const BUDGET_LABEL: Record<BudgetLevel, string> = {
  tight:   '초절약',
  budget:  '알뜰',
  mid:     '여유롭게',
  premium: '풍족하게',
  luxury:  '특별하게',
};

export function getBudgetStatus(cost: number, level: BudgetLevel): BudgetStatus {
  if (!cost || level === 'luxury') return 'ok';
  const target = BUDGET_SLOT_TARGET[level];
  if (cost > target * 2.5) return 'hard';
  if (cost > target * 1.5) return 'soft';
  return 'ok';
}

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

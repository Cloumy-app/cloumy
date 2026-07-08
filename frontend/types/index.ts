import type { SupportedLanguage } from '@/stores/useLanguageStore';

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
  transitSummary: string | null;
  transitDetail: string | null;
  tips: string | null;
  placeName: string;
  address: string | null;
  lat: number;
  lng: number;
  avgDurationMinutes: number | null;
}

// transitDetail(JSON 문자열)을 JSON.parse한 구간별 상세 — 정적 승하차 정보(실시간 도착정보 아님)
export interface TransitHop {
  mode: string;
  route: string;
  board_stop: string;
  alight_stop: string;
  minutes: number;
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
  placeId: string;
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

export interface RouteGenRequest {
  destination: string;
  startDate: string;
  endDate: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  tags: string[];
  hiddenGemRatio?: number;
  density?: Density;
  accommodations?: AccommodationInput[];
  totalBudget?: number; // 숙박비 제외 현지 활동/식사 예산, 선택 사항
  language?: SupportedLanguage; // 앱 설정 언어 — 하루요약/팁 텍스트 생성 언어(장소명은 원본 유지)
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

export interface ChatPlaceCard {
  placeId: string;
  name: string;
  tags: string;
  isHiddenGem: boolean;
  avgDurationMinutes: number | null;
  reason: string;
}

export interface ChatEstimatedSlot {
  slotId: string;
  day: number;
  orderIndex: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  places?: ChatPlaceCard[];
  estimatedSlot?: ChatEstimatedSlot;
}

// totalBudget이 null이면 이 루트에 예산이 설정되지 않은 것(에러 아님)
export interface BudgetSummary {
  totalBudget: number | null;
  foodRatio: number | null;
  transportRatio: number | null;
  activityRatio: number | null;
  etcRatio: number | null;
  plannedTotal: number;
  unplannedTotal: number;
  remaining: number | null;
}

export type ExpenseCategory = 'FOOD' | 'TRANSPORT' | 'ADMISSION' | 'SOUVENIR' | 'ETC';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  actualAmount: number;
  memo: string | null;
  createdAt: string;
}

export interface AddExpenseRequest {
  category: ExpenseCategory;
  actualAmount: number;
  memo?: string;
}

export interface BudgetReport {
  plannedTotal: number;
  unplannedByCategory: { category: string; total: number }[];
}

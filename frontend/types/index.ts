import type { SupportedLanguage } from '@/stores/useLanguageStore';

export interface User {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
  personaTags: string[];
  onboardingCompleted: boolean;
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
  isPublic: boolean;
  // 가는 편 출발 일시(선택 입력) — 프로액티브 T1(가는 편 준비) 전제. 미입력이면 null
  departureAt: string | null;
  // 오는 편 출발 일시(선택 입력) — RETURN_DEPARTURE 규칙 전제. 미입력이면 null
  returnAt: string | null;
}

// 공유 루트 가져오기 — 목적지 일치 공개 루트 브라우징 목록 항목
export interface PublicRouteListItem {
  id: string;
  title: string;
  destination: string;
  nights: number;
  tags: string[];
  saveCount: number;
  isBookmarked: boolean;
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
  categoryTags: string[];
}

export interface PlaceBrowseItem {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  categoryTags: string[];
  isHiddenGem: boolean;
  isBookmarked: boolean;
}

// 외부/수동 장소 find-or-create — 콘서트 검색/카카오 라이브 검색/유저 직접 입력이 공통으로 사용
export interface ExternalPlaceRequest {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  source: 'manual' | 'kakao' | 'event';
}

export interface ExternalPlaceResponse {
  placeId: string;
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

// 사전 고정 슬롯 기반 — 생성 전 이미 확정된 장소(day+place)
export interface FixedSlotInput {
  placeId: string;
  dayNumber: number;
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
  fixedSlots?: FixedSlotInput[];
  sourceRouteIds?: string[]; // 공유 루트 가져오기 — fixedSlots를 가져온 원본 루트 id(save_count 증가용)
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

// 챗봇이 추천한 장소를 어디에 넣을지 서버가 정한 자리 — "판단은 서버 규칙이, 문구는 앱이"
// 원칙(프로액티브와 동일)이라 한국어가 없다. source별 문구는 앱 i18n이 조립하고, 장소명은
// afterSlotId로 슬롯 캐시(['route-slots', routeId])에서 앱이 직접 찾아 붙인다.
export interface ChatInsertion {
  day: number;
  afterSlotId: string | null; // null이면 그 Day 맨 앞에 삽입
  // 'conversation'만 자리가 하나로 확정된 신호다("경복궁 가기 전에") — 이때만 확인 시트를
  // 생략하고 바로 삽입한다. 'conversation_day'는 Day만 말한 경우로, 자리(그 Day 맨 뒤)는
  // 서버가 고른 것이라 사용자 확인이 필요하다.
  source: 'conversation' | 'conversation_day' | 'estimated' | 'default';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  places?: ChatPlaceCard[];
  estimatedSlot?: ChatEstimatedSlot;
  insertion?: ChatInsertion;
}

// 프로액티브 개입 엔진 — 판단은 서버 규칙이, 문구는 앱이 조립한다(서버 응답엔 한국어가 없음).
// P1(PRE_TRIP_BRIEFING)의 flags 배열 항목 — 진단 종류마다 필요한 필드가 달라 kind로 판별한다.
export type ProactiveFlag =
  | { kind: 'rain' }
  | { kind: 'heat' }
  | { kind: 'cold' }
  | { kind: 'packed_day'; day: number }
  | { kind: 'far_from_stay'; day: number; distanceM: number }
  | { kind: 'long_walk'; day: number; minutes: number }
  | { kind: 'first_slot'; time: string; placeName: string };

export interface PreTripBriefingParams {
  nights: number;
  destination: string;
  flags: ProactiveFlag[];
}

export interface FlightDepartureParams {
  departureAt: string;
  leaveByTime: string;
}

// RETURN_DEPARTURE — T1(FlightDepartureParams)과 대칭. 여행 마지막 날 오는 편 준비 알림.
export interface ReturnDepartureParams {
  returnAt: string;
  leaveByTime: string;
}

export interface DepartureSoonParams {
  nextPlaceName: string;
  minutesLeft: number;
  transportMinutes: number;
}

export interface EmptyDayParams {
  day: number;
  slotCount: number;
}

export interface WeatherAlertParams {
  day: number;
  kind: 'rain' | 'heat' | 'cold';
  outdoorCount: number;
}

export interface BudgetOverParams {
  spentToday: number;
  dailyBudget: number;
}

export interface BookmarkNearbyParams {
  placeName: string;
  distanceM: number;
}

export interface FreeGapParams {
  gapMinutes: number;
}

export type ProactiveIntervention =
  | { type: 'PRE_TRIP_BRIEFING'; params: PreTripBriefingParams }
  | { type: 'FLIGHT_DEPARTURE'; params: FlightDepartureParams }
  | { type: 'RETURN_DEPARTURE'; params: ReturnDepartureParams }
  | { type: 'DEPARTURE_SOON'; params: DepartureSoonParams }
  | { type: 'EMPTY_DAY'; params: EmptyDayParams }
  | { type: 'WEATHER_ALERT'; params: WeatherAlertParams }
  | { type: 'BUDGET_OVER'; params: BudgetOverParams }
  | { type: 'BOOKMARK_NEARBY'; params: BookmarkNearbyParams }
  | { type: 'FREE_GAP'; params: FreeGapParams };

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

import type { TextStyle } from 'react-native';
import type { ExpenseCategory } from '@/types';

// 예산 화면군 전용 팔레트 — "여행 영수증" 모티프. 앱 전역 sky 브랜드와 의도적으로 분리(설계 문서 참고).
export const BUDGET_COLORS = {
  screenBg: '#F1ECDF',
  ledgerGreen: '#1F6F54',
  paper: '#FBF7EE',
  perforation: '#D8CCB4',
  rust: '#C1502E',
  ink: '#2A2620',
} as const;

// 지출 카테고리 5종(ExpenseCategory) — add-expense/report 화면 공용
export const EXPENSE_CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  FOOD: '#1F6F54',
  TRANSPORT: '#4C6B8A',
  ADMISSION: '#C1502E',
  SOUVENIR: '#8B5A62',
  ETC: '#8C8172',
};

// 예산 비율 배분 4종(food/transport/activity/etc) — CategoryRatioSliders 전용.
// ExpenseCategory와 분류 체계가 달라(activity는 admission+souvenir를 포괄하는 상위 개념) 별도 유지.
export const RATIO_CATEGORY_COLORS = {
  food: '#1F6F54',
  transport: '#4C6B8A',
  activity: '#C99A2E',
  etc: '#8C8172',
} as const;

// 금액 등 숫자를 자릿수 정렬로 보여줄 때 공용으로 쓰는 스타일 조각
export const TABULAR_NUMS: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
};

// 영수증 라벨 특유의 트래킹 넓은 작은 캡스 스타일 조각
export const RECEIPT_LABEL: Pick<TextStyle, 'letterSpacing' | 'textTransform'> = {
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};

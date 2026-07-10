export const PERSONA_TAGS = [
  'K_POP_PILGRIM',
  'K_DRAMA_FAN',
  'K_FOOD_LOVER',
  'K_BEAUTY_ADDICT',
  'CULTURE_EXPLORER',
  'NATURE_SEEKER',
  'SHOPPING_MAVEN',
  'CONTENT_CREATOR',
  'NIGHT_OWL',
  'CAFE_HOPPER',
] as const;

export type PersonaTag = (typeof PERSONA_TAGS)[number];

// 백엔드 PersonaTagAutoAssignService.PERSONA_THEMES와 반드시 동기화
// 주의: 이 THEMES(9종)는 실제 places.category_tags 어휘(11종, EXPLORE_CATEGORY_TAGS)와 다르다 —
// 카페/쇼핑/액티비티만 일치하고 나머지는 DB에 없는 이름이라 사실상 무필터가 됨
// (planning/unimplemented.md "테마 태그 어휘 불일치" 참고). route 생성 pre-select 전용, 탐색 탭엔 안 씀.
export const PERSONA_THEME_MAP: Partial<Record<PersonaTag, string[]>> = {
  K_FOOD_LOVER: ['맛집'],
  CAFE_HOPPER: ['카페'],
  NATURE_SEEKER: ['자연'],
  SHOPPING_MAVEN: ['쇼핑'],
  CULTURE_EXPLORER: ['문화', '관광'],
  NIGHT_OWL: ['야경'],
};

// 탐색 탭 필터 칩 — places.category_tags에 실제로 존재하는 11종 그대로(THEMES 재사용 안 함)
export const EXPLORE_CATEGORY_TAGS = [
  '식당', '먹방', '랜드마크', '뷰맛집', '액티비티',
  '실내', '역사', '쇼핑', '이벤트', '핫플', '카페',
] as const;

// 탐색 탭 전용 페르소나 → 실제 태그 기본필터. PERSONA_THEME_MAP과 다른 매핑(어휘 불일치 우회).
// NIGHT_OWL→핫플은 근사치(핫플은 시간대 무관 "요즘 뜨는 곳", Night Owl은 "야간 활동 선호") — 재검토 대상.
// NATURE_SEEKER는 대응 태그가 없어 매핑 안 함(다른 매핑 없는 페르소나와 동일 원칙).
export const PERSONA_EXPLORE_TAG_MAP: Partial<Record<PersonaTag, string[]>> = {
  K_FOOD_LOVER: ['먹방', '식당'],
  CAFE_HOPPER: ['카페'],
  SHOPPING_MAVEN: ['쇼핑'],
  CULTURE_EXPLORER: ['역사', '랜드마크'],
  NIGHT_OWL: ['핫플'],
};

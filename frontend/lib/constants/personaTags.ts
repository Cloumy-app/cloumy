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
export const PERSONA_THEME_MAP: Partial<Record<PersonaTag, string[]>> = {
  K_FOOD_LOVER: ['맛집'],
  CAFE_HOPPER: ['카페'],
  NATURE_SEEKER: ['자연'],
  SHOPPING_MAVEN: ['쇼핑'],
  CULTURE_EXPLORER: ['문화', '관광'],
  NIGHT_OWL: ['야경'],
};

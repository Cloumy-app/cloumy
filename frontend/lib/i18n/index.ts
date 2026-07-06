import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { createMMKV } from 'react-native-mmkv';
import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

const SUPPORTED_LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;

const storage = createMMKV({ id: 'settings' });

function resolveInitialLanguage(): (typeof SUPPORTED_LANGUAGES)[number] {
  const saved = storage.getString('language');
  if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
    return saved as (typeof SUPPORTED_LANGUAGES)[number];
  }

  const deviceLanguage = getLocales()[0]?.languageCode;
  if (deviceLanguage && (SUPPORTED_LANGUAGES as readonly string[]).includes(deviceLanguage)) {
    return deviceLanguage as (typeof SUPPORTED_LANGUAGES)[number];
  }

  // 방한 외국인 관광객이 기본 타겟이라, 지원 언어에 없는 로케일이면
  // 한국어가 아니라 영어를 폴백으로 둔다.
  return 'en';
}

i18next.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
    ja: { translation: ja },
    zh: { translation: zh },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18next;

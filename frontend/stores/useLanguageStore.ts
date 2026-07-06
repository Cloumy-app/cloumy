import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import i18next from '@/lib/i18n';

const storage = createMMKV({ id: 'settings' });

export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh';

interface LanguageStore {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: i18next.language as SupportedLanguage,

  setLanguage: (language) => {
    storage.set('language', language);
    i18next.changeLanguage(language);
    set({ language });
  },
}));

import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { MapPin, LogOut, ChevronRight, Globe } from 'lucide-react-native';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLanguageStore, type SupportedLanguage } from '@/stores/useLanguageStore';

const LANGUAGE_OPTIONS: { code: SupportedLanguage; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const initial = user?.nickname?.charAt(0).toUpperCase() ?? 'C';
  // 페르소나 태그는 "칭호" — 온보딩·자동추가로만 부여되고 여기서 직접 편집할 수 없음
  const personaTags = user?.personaTags ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 상단 프로필 카드 */}
        <View className="bg-white mx-6 mt-6 rounded-3xl p-6 items-center shadow-sm border border-slate-100">
          <View className="w-20 h-20 rounded-full bg-sky-100 items-center justify-center mb-4">
            <Text className="text-sky-600 font-bold text-3xl">{initial}</Text>
          </View>
          <Text className="text-xl font-bold text-slate-800 mb-1">
            {user?.nickname ?? t('profile.travelerFallback')}
          </Text>
          <Text className="text-sm text-slate-400">{t('profile.subtitle')}</Text>
        </View>

        {/* 내 루트 섹션 */}
        <View className="mx-6 mt-6">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('profile.myRoutesSection')}
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <TouchableOpacity
              className="flex-row items-center px-5 py-4 gap-3"
              onPress={() => router.push('/routes' as never)}
              activeOpacity={0.7}
            >
              <View className="w-9 h-9 rounded-xl bg-sky-50 items-center justify-center">
                <MapPin size={18} color="#0ea5e9" />
              </View>
              <Text className="flex-1 font-semibold text-slate-700">{t('profile.myRoutesLink')}</Text>
              <ChevronRight size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 내 여행 칭호 섹션 — 온보딩·자동추가로만 부여되는 읽기 전용 표시 */}
        <View className="mx-6 mt-4">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('profile.personaTagsSection')}
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden px-5 py-4">
            <View className="flex-row flex-wrap gap-2">
              {personaTags.map((tag) => (
                <View
                  key={tag}
                  className="flex-row items-center gap-1.5 bg-sky-50 border border-sky-200 rounded-2xl px-3 py-2"
                >
                  <Text className="text-sky-700 font-semibold text-xs">
                    {t(`personaTags.${tag}`)}
                  </Text>
                </View>
              ))}
              {personaTags.length === 0 && (
                <Text className="text-xs text-slate-400">{t('profile.noPersonaTags')}</Text>
              )}
            </View>
          </View>
        </View>

        {/* 언어 섹션 */}
        <View className="mx-6 mt-4">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('profile.languageSection')}
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden px-5 py-4">
            <View className="flex-row items-center gap-3 mb-3">
              <View className="w-9 h-9 rounded-xl bg-sky-50 items-center justify-center">
                <Globe size={18} color="#0ea5e9" />
              </View>
              <Text className="flex-1 font-semibold text-slate-700">{t('profile.languageSettings')}</Text>
            </View>
            <View className="flex-row gap-2">
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = language === option.code;
                return (
                  <TouchableOpacity
                    key={option.code}
                    onPress={() => setLanguage(option.code)}
                    className={`flex-1 py-2 rounded-xl border-2 items-center ${
                      selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                    activeOpacity={0.8}
                  >
                    <Text className={`text-xs font-bold ${selected ? 'text-sky-700' : 'text-slate-600'}`}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 계정 섹션 */}
        <View className="mx-6 mt-4 mb-8">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('profile.accountSection')}
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <TouchableOpacity
              className="flex-row items-center px-5 py-4 gap-3"
              onPress={logout}
              activeOpacity={0.7}
            >
              <View className="w-9 h-9 rounded-xl bg-rose-50 items-center justify-center">
                <LogOut size={18} color="#f43f5e" />
              </View>
              <Text className="flex-1 font-semibold text-rose-500">{t('profile.logout')}</Text>
              <ChevronRight size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

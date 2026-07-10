import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { devLogin } from '@/lib/api/auth';
import { API_BASE } from '@/lib/api/client';
import { useAuthStore } from '@/stores/useAuthStore';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const handleDevLogin = async () => {
    setLoading(true);
    try {
      const data = await devLogin();
      setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      router.replace(data.user.onboardingCompleted ? '/(tabs)' : '/(auth)/onboarding');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith('404')) {
        Alert.alert(t('login.connectFailedTitle'), t('login.devProfileHint'));
      } else if (/^\d{3}$/.test(message)) {
        Alert.alert(t('login.serverErrorTitle'), t('login.serverErrorBody', { httpCode: message }));
      } else {
        Alert.alert(t('login.connectFailedTitle'), t('login.connectFailedBody', { apiBase: API_BASE }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-8">
        {/* 로고 영역 */}
        <View className="items-center mb-16">
          <Text className="text-5xl font-bold text-sky-500">Cloumy</Text>
          <Text className="text-base text-slate-400 mt-2">{t('login.subtitle')}</Text>
        </View>

        {/* 소셜 로그인 버튼 */}
        <View className="w-full gap-3">
          <TouchableOpacity
            className="w-full bg-white border border-slate-200 rounded-xl py-4 items-center"
            onPress={() => Alert.alert(t('login.comingSoonTitle'), t('login.googleComingSoonBody'))}
          >
            <Text className="text-slate-700 font-semibold text-base">{t('login.googleButton')}</Text>
          </TouchableOpacity>

          {/* 개발자 전용 */}
          {__DEV__ && (
            <TouchableOpacity
              className="w-full bg-slate-100 rounded-xl py-4 items-center mt-4"
              onPress={handleDevLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#64748b" />
              ) : (
                <Text className="text-slate-500 font-medium text-sm">{t('login.devLoginButton')}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

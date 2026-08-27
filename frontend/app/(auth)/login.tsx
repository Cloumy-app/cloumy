import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { devLogin, socialLogin } from '@/lib/api/auth';
import { API_BASE } from '@/lib/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { GoogleLoginButton, GOOGLE_LOGIN_AVAILABLE } from '@/components/auth/GoogleLoginButton';
import type { User } from '@/types';

// 구글 동의창이 브라우저에서 앱으로 돌아온 뒤 잔여 세션을 정리한다 — 컴포넌트 안이 아니라 모듈 최상단에서 호출해야 한다
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  // 개발자 로그인과 구글 로그인 모두 여기서 성공 처리를 공유한다 (중복 로직 방지)
  const handleAuthSuccess = (data: {
    accessToken: string;
    refreshToken: string;
    user: User;
  }) => {
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    router.replace(data.user.onboardingCompleted ? '/(tabs)' : '/(auth)/onboarding');
  };

  const handleAuthError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith('404')) {
      Alert.alert(t('login.connectFailedTitle'), t('login.devProfileHint'));
    } else if (/^\d{3}$/.test(message)) {
      Alert.alert(t('login.serverErrorTitle'), t('login.serverErrorBody', { httpCode: message }));
    } else {
      Alert.alert(t('login.connectFailedTitle'), t('login.connectFailedBody', { apiBase: API_BASE }));
    }
  };

  const handleDevLogin = async () => {
    setLoading(true);
    try {
      handleAuthSuccess(await devLogin());
    } catch (e: unknown) {
      handleAuthError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleToken = async (accessToken: string) => {
    setLoading(true);
    try {
      handleAuthSuccess(await socialLogin('google', accessToken));
    } catch (e: unknown) {
      handleAuthError(e);
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
          {GOOGLE_LOGIN_AVAILABLE ? (
            <GoogleLoginButton loading={loading} onToken={handleGoogleToken} />
          ) : (
            // OAuth 클라이언트 ID가 없으면 GoogleLoginButton을 아예 렌더하지 않는다 —
            // useAuthRequest가 훅 안에서 throw해 로그인 화면이 통째로 크래시하기 때문이다.
            <View className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 items-center">
              <Text className="text-slate-400 font-medium text-base">{t('login.googleButton')}</Text>
              {__DEV__ && (
                <Text className="text-slate-400 text-xs mt-1">
                  EXPO_PUBLIC_GOOGLE_*_CLIENT_ID 미설정
                </Text>
              )}
            </View>
          )}

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

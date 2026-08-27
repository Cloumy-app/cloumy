import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { devLogin, socialLogin } from '@/lib/api/auth';
import { API_BASE } from '@/lib/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import type { User } from '@/types';

// 구글 동의창이 브라우저에서 앱으로 돌아온 뒤 잔여 세션을 정리한다 — 컴포넌트 안이 아니라 모듈 최상단에서 호출해야 한다
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

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
      const data = await devLogin();
      handleAuthSuccess(data);
    } catch (e: unknown) {
      handleAuthError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 사용자가 동의창을 취소한 경우는 에러가 아니므로 조용히 무시한다
    if (response?.type !== 'success') return;
    const accessToken = response.authentication?.accessToken;
    if (!accessToken) return;

    const run = async () => {
      setLoading(true);
      try {
        const data = await socialLogin('google', accessToken);
        handleAuthSuccess(data);
      } catch (e: unknown) {
        handleAuthError(e);
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

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
            onPress={() => promptAsync()}
            disabled={!request || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#334155" />
            ) : (
              <Text className="text-slate-700 font-semibold text-base">{t('login.googleButton')}</Text>
            )}
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

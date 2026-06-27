import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useState } from 'react';
import { devLogin } from '@/lib/api/auth';
import { API_BASE } from '@/lib/api/client';
import { useAuthStore } from '@/stores/useAuthStore';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const handleDevLogin = async () => {
    setLoading(true);
    try {
      const data = await devLogin();
      setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith('404')) {
        Alert.alert('연결 실패', 'Spring을 --spring.profiles.active=dev 로 실행해주세요.');
      } else if (/^\d{3}$/.test(message)) {
        Alert.alert('서버 오류', `서버가 오류를 반환했어요 (HTTP ${message})`);
      } else {
        Alert.alert('연결 실패', `서버에 연결할 수 없어요.\n${API_BASE}`);
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
          <Text className="text-base text-slate-400 mt-2">AI가 설계하는 나만의 여행 루트</Text>
        </View>

        {/* 소셜 로그인 버튼 */}
        <View className="w-full gap-3">
          <TouchableOpacity
            className="w-full bg-yellow-400 rounded-xl py-4 items-center"
            onPress={() => Alert.alert('준비 중', '카카오 로그인은 준비 중이에요.')}
          >
            <Text className="text-slate-900 font-semibold text-base">카카오로 시작하기</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="w-full bg-white border border-slate-200 rounded-xl py-4 items-center"
            onPress={() => Alert.alert('준비 중', '구글 로그인은 준비 중이에요.')}
          >
            <Text className="text-slate-700 font-semibold text-base">구글로 시작하기</Text>
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
                <Text className="text-slate-500 font-medium text-sm">개발자 로그인</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

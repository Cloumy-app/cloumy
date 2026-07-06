import '../global.css';
import '@/lib/i18n';
import { Stack, router } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';

const queryClient = new QueryClient();

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    // accessToken을 컴포넌트 구독 대신 store에서 직접 읽음
    // → 토큰 갱신 시 _layout이 리렌더되지 않아 네비게이션 컨텍스트 안정 유지
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isHydrated]);

  return (
    <GestureHandlerRootView className="flex-1">
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="route" />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

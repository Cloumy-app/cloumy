import { router } from 'expo-router';
import { useAuthStore } from '@/stores/useAuthStore';
import { refreshAccessToken } from './auth';

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';

export function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// 동시에 여러 요청이 401을 맞아도 refresh는 한 번만 실행되도록 진행 중인 Promise를 공유
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const { refreshToken, setTokens } = useAuthStore.getState();
  if (!refreshToken) return false;

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(refreshToken)
      .then(({ accessToken }) => {
        setTokens(accessToken, refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, { ...init, headers: { ...getAuthHeaders(), ...init.headers } });

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      useAuthStore.getState().logout();
      router.replace('/(auth)/login');
    }
  }
  return res;
}

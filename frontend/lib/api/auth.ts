import { API_BASE } from './client';
import type { User } from '@/types';

// 개발자 로그인·소셜 로그인 응답이 동형이라 두 함수가 이 타입을 공유한다
interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}

export async function devLogin(): Promise<AuthTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/v1/dev/token`, { method: 'POST', signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const body: { data: AuthTokenResponse } = await res.json();
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function socialLogin(
  provider: 'google',
  oauthAccessToken: string,
): Promise<AuthTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/v1/auth/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, oauthAccessToken }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const body: { data: AuthTokenResponse } = await res.json();
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: { accessToken: string } } = await res.json();
  return body.data;
}

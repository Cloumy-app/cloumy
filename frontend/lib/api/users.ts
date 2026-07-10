import { apiFetch } from './client';
import type { User } from '@/types';

export async function getMe(): Promise<User> {
  const res = await apiFetch('/v1/users/me');
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: User } = await res.json();
  return body.data;
}

// 온보딩 최초 1회만 호출 가능(서버가 강제) — 페르소나 태그는 "칭호" 개념이라
// 이후엔 자동추가(행동 기반)로만 갱신되고 유저가 직접 편집할 수 없다.
export async function completeOnboarding(tags: string[]): Promise<User> {
  const res = await apiFetch('/v1/users/me/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: User } = await res.json();
  return body.data;
}

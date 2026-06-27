import { API_BASE } from './client';
import type { User } from '@/types';

interface DevLoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}

export async function devLogin(): Promise<DevLoginResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/v1/dev/token`, { method: 'POST', signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const body: { data: DevLoginResponse } = await res.json();
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

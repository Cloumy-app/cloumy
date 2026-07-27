import { apiFetch } from './client';
import type { ProactiveIntervention } from '@/types';

// lib/api/chat.ts 패턴 그대로 — 배너는 실패해도 조용히 사라지면 되므로(FFE #11)
// 호출부(ProactiveBanner)가 isError를 보고 렌더를 생략한다.
export async function getProactive(routeId: string): Promise<ProactiveIntervention | null> {
  const res = await apiFetch(`/v1/routes/${routeId}/proactive`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: { intervention: ProactiveIntervention | null } } = await res.json();
  return body.data.intervention;
}

// 계측용(§계측) — DB 저장 없이 로그만 남기는 엔드포인트라 실패해도 배너 흐름을 막지 않고 조용히 무시한다.
export async function sendProactiveFeedback(
  routeId: string,
  type: string,
  action: 'tapped' | 'dismissed',
): Promise<void> {
  try {
    await apiFetch(`/v1/routes/${routeId}/proactive/feedback`, {
      method: 'POST',
      body: JSON.stringify({ type, action }),
    });
  } catch (e) {
    console.warn('[proactive] feedback 전송 실패 — 무시:', e);
  }
}

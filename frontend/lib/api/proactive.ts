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

// 계측용(§계측) — dismissed는 이제 서버(Redis)에 남아 그날 같은 개입을 다시 걸러낸다.
// 그래도 실패하면 배너 흐름을 막지 않고 조용히 무시한다(fail-open).
export async function sendProactiveFeedback(
  routeId: string,
  type: string,
  // auto_shown — 홈 배너를 거치지 않고 챗봇에 직접 들어와 자동으로 말을 건 경우.
  // tapped와 섞으면 배너 탭률이 왜곡되므로 별도 값으로 둔다.
  action: 'tapped' | 'dismissed' | 'auto_shown',
  // 장소 단위 규칙(Phase C)만 값이 있다. 장소 무관 규칙(기존 9종)은 undefined → 서버가 null로 받는다.
  placeId?: string,
): Promise<void> {
  try {
    await apiFetch(`/v1/routes/${routeId}/proactive/feedback`, {
      method: 'POST',
      body: JSON.stringify({ type, action, placeId: placeId ?? null }),
    });
  } catch (e) {
    console.warn('[proactive] feedback 전송 실패 — 무시:', e);
  }
}

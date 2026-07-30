import { apiFetch } from './client';
import { useLanguageStore } from '@/stores/useLanguageStore';
import type { ChatEstimatedSlot, ChatInsertion, ChatPlaceCard } from '@/types';

interface ChatApiResponse {
  reply: string;
  places: ChatPlaceCard[] | null;
  estimatedSlot: ChatEstimatedSlot | null;
  // 구버전 서버는 이 필드를 아예 안 내려줄 수 있다(FFE #11) — undefined도 함께 허용한다.
  insertion?: ChatInsertion | null;
}

// 프로액티브 배너 탭 직후 첫 메시지에만 실어 보내는 맥락. 완성 문장이 아니라 type+params만
// 보낸다 — 문장은 서버(FastAPI)가 스키마 검증 후 직접 조립한다. 완성 문장을 그대로 보내면
// 신뢰 경계가 왕복에서 깨져 시스템 프롬프트에 임의 지시를 주입하는 통로가 된다.
interface ProactivePayload {
  type: string;
  params: Record<string, unknown>;
}

export async function sendChatMessage(
  routeId: string,
  message: string,
  proactive?: ProactivePayload,
): Promise<{
  reply: string;
  places: ChatPlaceCard[];
  estimatedSlot: ChatEstimatedSlot | null;
  insertion: ChatInsertion | null;
}> {
  const language = useLanguageStore.getState().language;
  const res = await apiFetch('/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ routeId, message, language, proactive }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: ChatApiResponse } = await res.json();
  return {
    reply: body.data.reply,
    places: body.data.places ?? [],
    estimatedSlot: body.data.estimatedSlot ?? null,
    insertion: body.data.insertion ?? null,
  };
}

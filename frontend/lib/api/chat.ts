import { apiFetch } from './client';
import { useLanguageStore } from '@/stores/useLanguageStore';
import type { ChatEstimatedSlot, ChatPlaceCard } from '@/types';

interface ChatApiResponse {
  reply: string;
  places: ChatPlaceCard[] | null;
  estimatedSlot: ChatEstimatedSlot | null;
}

export async function sendChatMessage(
  routeId: string,
  message: string,
  // 프로액티브 배너 탭 직후 첫 메시지에만 실어 보내는 맥락 — "[방금 먼저 안내한 내용]"으로
  // 시스템 프롬프트에 덧붙여진다(useChatStore.sendMessage가 첫 호출 후 즉시 clear)
  proactiveContext?: string,
): Promise<{ reply: string; places: ChatPlaceCard[]; estimatedSlot: ChatEstimatedSlot | null }> {
  const language = useLanguageStore.getState().language;
  const res = await apiFetch('/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ routeId, message, language, proactiveContext }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: ChatApiResponse } = await res.json();
  return {
    reply: body.data.reply,
    places: body.data.places ?? [],
    estimatedSlot: body.data.estimatedSlot ?? null,
  };
}

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
): Promise<{ reply: string; places: ChatPlaceCard[]; estimatedSlot: ChatEstimatedSlot | null }> {
  const language = useLanguageStore.getState().language;
  const res = await apiFetch('/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ routeId, message, language }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: ChatApiResponse } = await res.json();
  return {
    reply: body.data.reply,
    places: body.data.places ?? [],
    estimatedSlot: body.data.estimatedSlot ?? null,
  };
}

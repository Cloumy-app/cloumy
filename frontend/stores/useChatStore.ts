import { create } from 'zustand';
import { sendChatMessage } from '@/lib/api/chat';
import type { ChatMessage } from '@/types';

interface ChatStore {
  messages: ChatMessage[];
  isSending: boolean;
  activeRouteId: string | null;
  // 프로액티브 배너 탭으로 진입했을 때만 채워짐 — sendMessage 첫 호출에만 실어 보내고 즉시 clear
  // text: 배너에 표시된 문구 그대로 저장 (메시지 배열 역탐색 없이 바로 사용하기 위함)
  pendingProactive: { type: string; params: Record<string, unknown>; text: string } | null;
  setActiveRouteId: (routeId: string | null) => void;
  sendMessage: (text: string) => Promise<void>;
  seedFromProactive: (type: string, params: Record<string, unknown>, text: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isSending: false,
  activeRouteId: null,
  pendingProactive: null,

  setActiveRouteId: (routeId) => set({ activeRouteId: routeId }),

  // 배너 탭 시: 어시스턴트 말풍선 1개를 배너와 동일 문구로 미리 넣고 맥락을 저장한다.
  seedFromProactive: (type, params, text) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: `${Date.now()}-proactive`, role: 'assistant', content: text, createdAt: new Date() },
      ],
      pendingProactive: { type, params, text },
    })),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    const { activeRouteId, isSending, pendingProactive } = get();
    if (!activeRouteId || !trimmed || isSending) return;

    // pendingProactive가 있으면 seedFromProactive에서 저장해둔 배너 문구를 이번 전송에만 실어 보낸다.
    // 즉시 클리어해야 다음 메시지부터는 맥락이 중복으로 안 실린다.
    const proactiveContext = pendingProactive?.text;
    if (pendingProactive) set({ pendingProactive: null });

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed,
      createdAt: new Date(),
    };
    set((s) => ({ messages: [...s.messages, userMessage], isSending: true }));

    try {
      const { reply, places, estimatedSlot } = await sendChatMessage(
        activeRouteId,
        trimmed,
        proactiveContext,
      );
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: reply,
        createdAt: new Date(),
        places: places.length > 0 ? places : undefined,
        estimatedSlot: estimatedSlot ?? undefined,
      };
      set((s) => ({ messages: [...s.messages, assistantMessage], isSending: false }));
    } catch (e) {
      console.error('[chat] sendChatMessage 실패:', e);
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: '메시지를 보내지 못했어요. 잠시 후 다시 시도해주세요.',
        createdAt: new Date(),
      };
      set((s) => ({ messages: [...s.messages, errorMessage], isSending: false }));
    }
  },

  reset: () => set({ messages: [], isSending: false, activeRouteId: null, pendingProactive: null }),
}));

import { create } from 'zustand';
import { sendChatMessage } from '@/lib/api/chat';
import type { ChatMessage } from '@/types';

interface ChatStore {
  messages: ChatMessage[];
  isSending: boolean;
  activeRouteId: string | null;
  setActiveRouteId: (routeId: string | null) => void;
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isSending: false,
  activeRouteId: null,

  setActiveRouteId: (routeId) => set({ activeRouteId: routeId }),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    const { activeRouteId, isSending } = get();
    if (!activeRouteId || !trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed,
      createdAt: new Date(),
    };
    set((s) => ({ messages: [...s.messages, userMessage], isSending: true }));

    try {
      const { reply, places, estimatedSlot } = await sendChatMessage(activeRouteId, trimmed);
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

  reset: () => set({ messages: [], isSending: false, activeRouteId: null }),
}));

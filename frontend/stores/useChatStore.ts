import { create } from 'zustand';
import { sendChatMessage } from '@/lib/api/chat';
import type { ChatMessage } from '@/types';

// 대화는 루트에 귀속된다. 다른 여행으로 바뀌면 이전 대화는 맥락이 아니라 잡음이므로 비운다.
// 이 규칙이 없으면 messages가 앱 세션 내내 누적돼, 챗봇 자동 개입 가드(messages.length > 0)가
// 한 번 대화한 뒤로는 영구히 막히고 무관한 대화 끝에 개입 말풍선이 붙는다.
interface ChatStore {
  messages: ChatMessage[];
  isSending: boolean;
  activeRouteId: string | null;
  // 프로액티브 배너 탭으로 진입했을 때만 채워짐 — sendMessage 첫 호출에만 실어 보내고 즉시 clear
  // text: 배너에 표시된 문구 그대로 저장 (메시지 배열 역탐색 없이 바로 사용하기 위함)
  pendingProactive: { type: string; params: Record<string, unknown>; text: string } | null;
  setActiveRouteId: (routeId: string | null) => void;
  sendMessage: (text: string) => Promise<void>;
  seedFromProactive: (
    routeId: string,
    type: string,
    params: Record<string, unknown>,
    text: string,
  ) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isSending: false,
  activeRouteId: null,
  pendingProactive: null,

  // 루트가 실제로 바뀔 때만 대화를 비운다. 같은 routeId로 다시 불리는 경우(쿼리 refetch)에
  // 비우면 화면에 머무는 동안 대화가 통째로 날아간다.
  setActiveRouteId: (routeId) =>
    set((s) =>
      s.activeRouteId === routeId
        ? { activeRouteId: routeId }
        : { activeRouteId: routeId, messages: [], pendingProactive: null },
    ),

  // 배너 탭 시: 어시스턴트 말풍선 1개를 배너와 동일 문구로 미리 넣고 맥락을 저장한다.
  // routeId를 함께 확정하는 이유 — 홈에서 배너를 탭하는 시점엔 activeRouteId가 아직 null일 수
  // 있고(챗을 연 적이 없으면), 그대로 두면 챗 화면이 마운트되며 setActiveRouteId(null → routeId)를
  // 불러 '루트 변경'으로 판정해 방금 넣은 말풍선을 지워버린다.
  seedFromProactive: (routeId, type, params, text) =>
    set((s) => ({
      activeRouteId: routeId,
      messages: [
        ...(s.activeRouteId === routeId ? s.messages : []),
        { id: `${Date.now()}-proactive`, role: 'assistant', content: text, createdAt: new Date() },
      ],
      pendingProactive: { type, params, text },
    })),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    const { activeRouteId, isSending, pendingProactive } = get();
    if (!activeRouteId || !trimmed || isSending) return;

    // pendingProactive가 있으면 seedFromProactive에서 저장해둔 type+params를 이번 전송에만 실어 보낸다.
    // 완성 문장(text)이 아니라 type+params를 보내야 서버가 문장을 직접 조립해 검증한다 —
    // 문장을 그대로 보내면 시스템 프롬프트에 임의 지시를 주입하는 통로가 된다.
    // 즉시 클리어해야 다음 메시지부터는 맥락이 중복으로 안 실린다.
    const proactive = pendingProactive
      ? { type: pendingProactive.type, params: pendingProactive.params }
      : undefined;
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
        proactive,
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

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, MessageCircle, Plus, Send, Sparkles } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getActiveRoute, insertRouteSlot } from '@/lib/api/routes';
import { getProactive, sendProactiveFeedback } from '@/lib/api/proactive';
import { isDismissedToday, dismissToday } from '@/lib/proactiveDismissal';
import { buildProactiveText, asI18nParams } from '@/lib/proactiveText';
import { useChatStore } from '@/stores/useChatStore';
import type { ChatEstimatedSlot, ChatMessage, ChatPlaceCard } from '@/types';

function PlaceCardList({
  places,
  estimatedSlot,
  routeId,
}: {
  places: ChatPlaceCard[];
  estimatedSlot?: ChatEstimatedSlot;
  routeId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const canInsert = !!estimatedSlot;

  const handleAdd = async (place: ChatPlaceCard) => {
    if (!estimatedSlot || insertingId || addedIds.has(place.placeId)) return;
    setInsertingId(place.placeId);
    try {
      await insertRouteSlot(routeId, estimatedSlot.slotId, place.placeId, place.reason);
      queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
      setAddedIds((prev) => new Set(prev).add(place.placeId));
    } catch (e) {
      console.error('[chat] insertRouteSlot 실패:', e);
      Alert.alert(t('chat.addFailedTitle'), t('chat.addFailedBody'));
    } finally {
      setInsertingId(null);
    }
  };

  return (
    <View className="w-[85%] mt-2 p-3 bg-sky-50 border border-sky-100 rounded-2xl">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Sparkles size={13} color="#0369a1" />
        <Text className="text-xs font-bold text-sky-800">{t('chat.recommendedPlaces')}</Text>
      </View>
      {places.map((place, i) => {
        const added = addedIds.has(place.placeId);
        return (
          <TouchableOpacity
            key={`${place.placeId}-${i}`}
            className="flex-row items-start gap-2 p-3 bg-white rounded-xl border border-sky-100 mb-2 last:mb-0"
            onPress={() => handleAdd(place)}
            disabled={!canInsert || added || insertingId !== null}
            activeOpacity={canInsert ? 0.7 : 1}
          >
            <View className="w-6 h-6 rounded-full bg-sky-500 items-center justify-center mt-0.5 shrink-0">
              <Text className="text-white font-black text-[10px]">{i + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className="font-bold text-slate-800 text-sm">{place.name}</Text>
              <Text className="text-slate-400 text-xs mt-0.5" numberOfLines={1}>
                {place.tags}
                {place.isHiddenGem ? ' · 🔮 Hidden Gem' : ''}
              </Text>
              {place.reason && (
                <Text className="text-slate-400 text-xs mt-1" numberOfLines={2}>
                  {place.reason}
                </Text>
              )}
            </View>
            {canInsert &&
              (insertingId === place.placeId ? (
                <ActivityIndicator size="small" color="#0ea5e9" />
              ) : added ? (
                <Check size={16} color="#22c55e" />
              ) : (
                <Plus size={16} color="#0ea5e9" />
              ))}
          </TouchableOpacity>
        );
      })}
      {canInsert && (
        <Text className="text-[11px] text-sky-700 mt-1">{t('chat.insertHint')}</Text>
      )}
    </View>
  );
}

function MessageBubble({ message, routeId }: { message: ChatMessage; routeId: string }) {
  const isUser = message.role === 'user';
  return (
    <View className={`mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
          isUser ? 'bg-sky-500 rounded-br-md' : 'bg-slate-100 rounded-bl-md'
        }`}
      >
        <Text className={isUser ? 'text-white' : 'text-slate-800'}>{message.content}</Text>
      </View>
      {!isUser && message.places && (
        <PlaceCardList places={message.places} estimatedSlot={message.estimatedSlot} routeId={routeId} />
      )}
    </View>
  );
}

export default function ChatScreen() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);
  const { messages, isSending, activeRouteId, setActiveRouteId, sendMessage, seedFromProactive } =
    useChatStore();

  // 홈과 같은 쿼리 키('routes','active')를 써서 항상 같은 루트를 가리키게 한다 —
  // 예전에는 홈이 getMyRoutes(0,5), 챗봇이 getMyRoutes(0,1)로 같은 캐시 키를 다른 size로
  // 공유해 크기 불일치 버그가 있었다(계획 Step 2-2, FFE #13).
  const { data: activeRoute, isLoading } = useQuery({
    queryKey: ['routes', 'active'],
    queryFn: getActiveRoute,
    staleTime: 1000 * 60 * 2,
  });

  useEffect(() => {
    if (activeRoute) setActiveRouteId(activeRoute.id);
  }, [activeRoute, setActiveRouteId]);

  // 홈 배너를 거치지 않고 탭바로 직접 들어온 경우에도 챗봇이 먼저 말을 건다.
  // 배너에서만 말을 걸면 "같은 시점, 같은 개입인데 어디로 들어왔느냐에 따라 다르게" 동작한다.
  // 조회 키(['proactive', routeId])와 문구 조립을 배너와 공유해 항상 같은 말이 나오게 한다.
  const { data: intervention } = useQuery({
    queryKey: ['proactive', activeRouteId],
    queryFn: () => getProactive(activeRouteId as string),
    enabled: !!activeRouteId,
    staleTime: 1000 * 60 * 5,
    retry: false, // 실패하면 조용히 넘어간다 — 개입은 없어도 되는 것이다(FFE #11)
  });

  useEffect(() => {
    if (!activeRouteId || !intervention) return;
    // 이 루트의 대화가 이미 진행 중이면 끼어들지 않는다. messages는 setActiveRouteId가
    // 루트 전환 때 비우므로 '전역 대화'가 아니라 '이 루트의 대화'를 뜻한다.
    if (messages.length > 0) return;
    // 배너를 탭해 들어온 경우는 여기서 걸린다 — 배너가 seedFromProactive보다 먼저
    // dismissToday를 찍기 때문이다(ProactiveBanner.handleTap).
    if (isDismissedToday(activeRouteId, intervention.type)) return;

    dismissToday(activeRouteId, intervention.type);
    sendProactiveFeedback(activeRouteId, intervention.type, 'auto_shown');
    seedFromProactive(
      activeRouteId,
      intervention.type,
      asI18nParams(intervention.params),
      buildProactiveText(t, i18n.language, intervention),
    );
  }, [activeRouteId, intervention, messages.length, seedFromProactive, t, i18n.language]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = () => {
    if (!input.trim() || isSending) return;
    const text = input;
    setInput('');
    sendMessage(text);
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  if (!activeRouteId) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <MessageCircle size={48} color="#94a3b8" />
        <Text className="text-slate-400 font-medium mt-4 text-center">{t('chat.emptyRoute')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <View className="px-5 py-3 border-b border-slate-100">
        <Text className="text-lg font-bold text-slate-800">{t('chat.title')}</Text>
        <Text className="text-xs text-slate-400 mt-0.5">{t('chat.subtitle')}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} routeId={activeRouteId} />}
        contentContainerStyle={{ padding: 20, flexGrow: 1 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center">
            <MessageCircle size={40} color="#cbd5e1" />
            <Text className="text-slate-300 mt-3 text-sm">{t('chat.emptyHint')}</Text>
          </View>
        }
      />

      {isSending && (
        <View className="px-5 pb-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#94a3b8" />
          <Text className="text-slate-400 text-xs">{t('chat.sending')}</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-2 px-4 py-3 border-t border-slate-100">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('chat.inputPlaceholder')}
            className="flex-1 bg-slate-100 rounded-full px-4 py-3 text-slate-800"
            editable={!isSending}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!input.trim() || isSending}
            className={`w-11 h-11 rounded-full items-center justify-center ${
              input.trim() && !isSending ? 'bg-sky-500' : 'bg-slate-200'
            }`}
          >
            <Send size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
import { getActiveRoute, getRouteSlots, insertRouteSlot } from '@/lib/api/routes';
import { getProactive, sendProactiveFeedback } from '@/lib/api/proactive';
import { isDismissedToday, dismissToday } from '@/lib/proactiveDismissal';
import { buildProactiveText, asI18nParams } from '@/lib/proactiveText';
import { useChatStore } from '@/stores/useChatStore';
import { InsertPlaceSheet } from '@/components/route/InsertPlaceSheet';
import type { ChatInsertion, ChatMessage, ChatPlaceCard } from '@/types';

function PlaceCardList({
  places,
  insertion,
  routeId,
  nights,
}: {
  places: ChatPlaceCard[];
  insertion?: ChatInsertion;
  routeId: string;
  nights?: number;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [sheetPlace, setSheetPlace] = useState<ChatPlaceCard | null>(null);
  // FFE #6 — 삽입 중 404(기준 슬롯이 이미 삭제됨)를 맞으면 시트를 닫지 않고 다시 고르게 한다.
  // 이때 원래 제안(insertion)을 그대로 다시 보여주면 이미 사라진 자리를 또 고르게 되므로,
  // 강제로 "Day 미선택" 상태로 리셋해 무효화 후 새로 받아온 슬롯 목록에서 새로 고르게 한다.
  const [forceManualPick, setForceManualPick] = useState(false);

  // 대화에서 자리가 하나로 확정된 경우만 시트를 건너뛴다. 'conversation_day'(= "2일차에"만
  // 말한 경우)는 자리가 그 Day 맨 뒤인데 사용자가 그걸 말한 게 아니라 서버가 고른 것이라
  // 여전히 확인을 받는다.
  const isDirectInsert = insertion?.source === 'conversation';

  // 바로 추가되는 경우엔 어디로 가는지 탭 전에 알려준다 — 시트가 없으니 누른 뒤에 알 방법이
  // 없다. InsertPlaceSheet와 같은 쿼리 키라 캐시를 공유해 추가 요청이 나가지 않는다.
  const { data: slots } = useQuery({
    queryKey: ['route-slots', routeId],
    queryFn: () => getRouteSlots(routeId),
    staleTime: 1000 * 60 * 5,
    enabled: isDirectInsert,
  });

  // Day를 함께 보여주는 이유: _match_slot이 부분 일치를 쓰고 같은 이름이 여러 Day에 있으면
  // "오늘 이후 첫 번째"를 고르므로, 드물지만 의도와 다른 Day가 잡힐 수 있다. Day를 명시하면
  // 누르기 전에 눈에 띈다. 앵커 이름을 아직 못 구했으면(캐시 미도착, FFE #1) 기존 문구로
  // 폴백한다 — 자리는 서버가 이미 정했으니 탭 자체는 그대로 동작한다.
  const anchorName = insertion?.afterSlotId
    ? slots?.find((s) => s.id === insertion.afterSlotId)?.placeName
    : undefined;
  let hintText = t('chat.insertHint');
  if (isDirectInsert && insertion) {
    if (insertion.afterSlotId == null) {
      hintText = t('chat.insertDirectHintFront', { day: insertion.day });
    } else if (anchorName) {
      hintText = t('chat.insertDirectHint', { day: insertion.day, name: anchorName });
    }
  }

  // 바로 추가 경로와 시트 확정 경로가 공유한다 — 성공/실패 처리가 갈라지면 한쪽만 고치는
  // 사고가 난다. 시트가 열려 있지 않을 수도 있어서(바로 추가) place를 인자로 받는다.
  const insertPlace = async (place: ChatPlaceCard, afterSlotId: string | null, dayNumber: number) => {
    setInsertingId(place.placeId);
    try {
      await insertRouteSlot(routeId, afterSlotId, dayNumber, place.placeId, place.reason);
      queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
      setAddedIds((prev) => new Set(prev).add(place.placeId));
      setSheetPlace(null);
    } catch (e) {
      console.error('[chat] insertRouteSlot 실패:', e);
      if (e instanceof Error && e.message === '404') {
        // 기준 슬롯이 다른 기기에서 이미 삭제됐다(FFE #6). 바로 추가 경로에서도 조용히
        // 실패시키지 않고 시트를 열어 새 목록에서 다시 고르게 한다 — 안 그러면 사용자는
        // 왜 추가가 안 됐는지 알 수 없다.
        Alert.alert(t('chat.insertSheet.slotGoneTitle'), t('chat.insertSheet.slotGoneBody'));
        queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
        setForceManualPick(true);
        setSheetPlace(place);
      } else {
        // 자리 문제가 아니라 통신·서버 오류다 — 시트를 열어봤자 같은 실패를 반복한다.
        Alert.alert(t('chat.addFailedTitle'), t('chat.addFailedBody'));
        setSheetPlace(null);
      }
    } finally {
      setInsertingId(null);
    }
  };

  const handleConfirmInsert = (afterSlotId: string | null, dayNumber: number) => {
    if (!sheetPlace) return;
    insertPlace(sheetPlace, afterSlotId, dayNumber);
  };

  // 카드는 항상 누를 수 있다 — 예전엔 canInsert = !!estimatedSlot 게이트가 있어서, 서버의
  // 시간 기반 위치 추정이 실패하는 밤 시간대(마지막 일정 종료 후)엔 카드 전체가 disabled로
  // 빠지고 +아이콘·안내 문구까지 숨겨져 "그냥 안 눌리는 목록"으로 보였다.
  const handlePress = (place: ChatPlaceCard) => {
    if (insertingId || addedIds.has(place.placeId)) return;
    setForceManualPick(false);
    if (isDirectInsert && insertion) {
      // "경복궁 가기 전에 카페" — 방금 사용자가 말한 자리를 되물어 확인받지 않는다.
      insertPlace(place, insertion.afterSlotId, insertion.day);
      return;
    }
    setSheetPlace(place);
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
            onPress={() => handlePress(place)}
            disabled={added || insertingId !== null}
            activeOpacity={0.7}
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
            {insertingId === place.placeId ? (
              <ActivityIndicator size="small" color="#0ea5e9" />
            ) : added ? (
              <Check size={16} color="#22c55e" />
            ) : (
              <Plus size={16} color="#0ea5e9" />
            )}
          </TouchableOpacity>
        );
      })}
      <Text className="text-[11px] text-sky-700 mt-1">{hintText}</Text>

      {sheetPlace && (
        <InsertPlaceSheet
          key={`${sheetPlace.placeId}-${forceManualPick}`}
          placeName={sheetPlace.name}
          routeId={routeId}
          insertion={forceManualPick ? undefined : insertion}
          nights={nights}
          loading={insertingId === sheetPlace.placeId}
          onConfirm={handleConfirmInsert}
          onCancel={() => setSheetPlace(null)}
        />
      )}
    </View>
  );
}

function MessageBubble({
  message,
  routeId,
  nights,
}: {
  message: ChatMessage;
  routeId: string;
  nights?: number;
}) {
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
        <PlaceCardList places={message.places} insertion={message.insertion} routeId={routeId} nights={nights} />
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
        renderItem={({ item }) => (
          <MessageBubble message={item} routeId={activeRouteId} nights={activeRoute?.nights} />
        )}
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

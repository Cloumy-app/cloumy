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
import { getMyRoutes, insertRouteSlot } from '@/lib/api/routes';
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
      Alert.alert('추가 실패', '일정에 추가하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setInsertingId(null);
    }
  };

  return (
    <View className="w-[85%] mt-2 p-3 bg-sky-50 border border-sky-100 rounded-2xl">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Sparkles size={13} color="#0369a1" />
        <Text className="text-xs font-bold text-sky-800">추천 장소</Text>
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
        <Text className="text-[11px] text-sky-700 mt-1">탭하면 다음 일정 사이에 추가돼요</Text>
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
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);
  const { messages, isSending, activeRouteId, setActiveRouteId, sendMessage } = useChatStore();

  const { data, isLoading } = useQuery({
    queryKey: ['routes', 'list'],
    queryFn: () => getMyRoutes(0, 1),
    staleTime: 1000 * 60 * 2,
  });

  useEffect(() => {
    const latestRoute = data?.content[0] ?? null;
    if (latestRoute) setActiveRouteId(latestRoute.id);
  }, [data, setActiveRouteId]);

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
        <Text className="text-slate-400 font-medium mt-4 text-center">
          여행 일정을 먼저 만들어주세요.{'\n'}만든 일정에 대해 챗봇과 대화할 수 있어요.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <View className="px-5 py-3 border-b border-slate-100">
        <Text className="text-lg font-bold text-slate-800">AI 챗봇</Text>
        <Text className="text-xs text-slate-400 mt-0.5">현재 여행 일정에 대해 물어보세요</Text>
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
            <Text className="text-slate-300 mt-3 text-sm">
              &ldquo;근처 맛집 추천해줘&rdquo;, &ldquo;오늘 날씨 어때?&rdquo; 처럼 물어보세요
            </Text>
          </View>
        }
      />

      {isSending && (
        <View className="px-5 pb-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#94a3b8" />
          <Text className="text-slate-400 text-xs">답변 작성 중...</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-2 px-4 py-3 border-t border-slate-100">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="메시지를 입력하세요"
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

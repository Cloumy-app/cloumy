import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, Settings2, Sparkles } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteSlots, toggleSlotPin as apiToggleSlotPin, deleteRouteSlot } from '@/lib/api/routes';
import { useRouteStore } from '@/stores/useRouteStore';
import { TripMap } from '@/components/map/TripMap';
import { DayTabs } from '@/components/route/DayTabs';
import { SlotCard } from '@/components/route/SlotCard';
import { PlaceDetailSheet } from '@/components/route/PlaceDetailSheet';
import type { SlotAlternative, SlotWithCoords } from '@/types';

export default function RouteResultScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const queryClient = useQueryClient();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const { currentRoute, streamingSlots, isStreaming, selectedDay, setSelectedDay, toggleSlotPin, removeSlot } =
    useRouteStore();

  // 스트리밍 완료 후 API에서 슬롯 로드 (lat/lng 포함)
  const { data: apiSlots, isLoading: slotsLoading } = useQuery({
    queryKey: ['route-slots', routeId],
    queryFn: () => getRouteSlots(routeId!),
    enabled: !!routeId && !isStreaming,
    staleTime: 1000 * 60 * 5,
  });

  const hasApiSlots = apiSlots && apiSlots.length > 0;
  const streamSlots = currentRoute?.slots ?? streamingSlots;

  const days = hasApiSlots
    ? [...new Set(apiSlots.map((s) => s.dayNumber))].sort()
    : [...new Set(streamSlots.map((s) => s.day))].sort();

  const currentDayApiSlots: SlotWithCoords[] = hasApiSlots
    ? apiSlots.filter((s) => s.dayNumber === selectedDay)
    : [];

  const currentDayStreamSlots = streamSlots.filter((s) => s.day === selectedDay);
  const destination = currentRoute?.destination ?? '';

  const handleReplaceWithAlternative = (slotId: string, alt: SlotAlternative) => {
    queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
      prev?.map((s) =>
        s.id === slotId
          ? { ...s, placeName: alt.placeName, lat: alt.lat, lng: alt.lng, estimatedCost: alt.estimatedCost, tips: alt.reason }
          : s,
      ),
    );
  };

  const handlePin = async (slotId: string) => {
    if (!routeId) return;
    try {
      const updated = await apiToggleSlotPin(routeId, slotId);
      queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
        prev?.map((s) => (s.id === slotId ? { ...s, pinned: updated.pinned } : s)),
      );
    } catch {
      // 핀 토글 실패 시 무시 (서버 상태 유지)
    }
  };

  const handleDelete = async (slotId: string) => {
    if (!routeId) return;
    try {
      await deleteRouteSlot(routeId, slotId);
      queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
        prev?.filter((s) => s.id !== slotId),
      );
    } catch {
      // 삭제 실패 시 무시
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* 헤더 */}
      <View className="flex-row justify-between items-center px-6 py-3">
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="items-center">
          <View className="flex-row items-center gap-1">
            <Text className="font-bold text-slate-800 text-base">
              {destination || '루트 생성 중'}
            </Text>
            {isStreaming && <Sparkles size={14} color="#0ea5e9" />}
          </View>
          {currentRoute && (
            <Text className="text-xs text-slate-500">
              {currentRoute.startDate} ~ {currentRoute.endDate}
            </Text>
          )}
        </View>
        <TouchableOpacity>
          <Settings2 size={22} color="#475569" />
        </TouchableOpacity>
      </View>

      {/* 지도 — 스트리밍 완료 + lat/lng 있을 때 */}
      {!isStreaming && hasApiSlots && (
        <TripMap slots={apiSlots} selectedDay={selectedDay} height={260} />
      )}

      {/* 스트리밍 배너 */}
      {isStreaming && (
        <View className="mx-6 mb-2 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#0ea5e9" />
          <Text className="text-sky-700 text-sm font-medium">AI가 루트를 생성하고 있어요...</Text>
        </View>
      )}

      {slotsLoading && !isStreaming && (
        <View className="flex-row justify-center py-3">
          <ActivityIndicator size="small" color="#0ea5e9" />
        </View>
      )}

      {/* DayTabs */}
      {hasApiSlots ? (
        <DayTabs slots={apiSlots} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      ) : days.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="px-6 mb-3"
          contentContainerClassName="gap-2"
        >
          {days.map((day) => (
            <TouchableOpacity
              key={day}
              onPress={() => setSelectedDay(day)}
              className={`px-4 py-2 rounded-full border ${
                selectedDay === day ? 'bg-sky-500 border-sky-500' : 'bg-white border-slate-200'
              }`}
            >
              <Text className={`font-bold text-sm ${selectedDay === day ? 'text-white' : 'text-slate-600'}`}>
                {day}일차
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {/* 타임라인 */}
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-4 pb-8 pt-2"
      >
        {hasApiSlots ? (
          currentDayApiSlots.length === 0 ? (
            <View className="items-center justify-center py-16">
              <Text className="text-slate-400 font-medium">이 날 슬롯이 없습니다</Text>
            </View>
          ) : (
            currentDayApiSlots.map((apiSlot, i) => (
              <SlotCard
                key={apiSlot.id}
                slot={null}
                apiSlot={apiSlot}
                index={i}
                isLast={i === currentDayApiSlots.length - 1}
                routeId={routeId}
                onPin={() => handlePin(apiSlot.id)}
                onRemove={() => handleDelete(apiSlot.id)}
                onReplaceWithAlternative={(alt) => handleReplaceWithAlternative(apiSlot.id, alt)}
                onTap={() => setSelectedPlaceId(apiSlot.placeId)}
              />
            ))
          )
        ) : (
          currentDayStreamSlots.map((slot, i) => (
            <SlotCard
              key={`${slot.day}-${slot.order}`}
              slot={slot}
              index={i}
              isLast={i === currentDayStreamSlots.length - 1}
              onPin={() => toggleSlotPin(slot.day, slot.order)}
              onRemove={() => removeSlot(slot.day, slot.order)}
            />
          ))
        )}

        {isStreaming && (
          <View className="items-center py-4">
            <ActivityIndicator color="#0ea5e9" />
            <Text className="text-slate-400 text-xs mt-2">장소를 찾는 중...</Text>
          </View>
        )}
      </ScrollView>

      <PlaceDetailSheet
        placeId={selectedPlaceId}
        onClose={() => setSelectedPlaceId(null)}
      />
    </SafeAreaView>
  );
}

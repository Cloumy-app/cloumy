import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, Settings2, Sparkles, CheckCircle, Wallet } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteSlots, toggleSlotPin as apiToggleSlotPin, deleteRouteSlot } from '@/lib/api/routes';
import { fetchCurrentWeather } from '@/lib/api/weather';
import { useRouteStore } from '@/stores/useRouteStore';
import { TripMap } from '@/components/map/TripMap';
import { DayTabs } from '@/components/route/DayTabs';
import { SlotCard } from '@/components/route/SlotCard';
import { PlaceDetailSheet } from '@/components/route/PlaceDetailSheet';
import type { BudgetLevel, SlotAlternative, SlotWithCoords } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function RouteResultScreen() {
  const { routeId, budgetLevel } = useLocalSearchParams<{ routeId: string; budgetLevel?: string }>();
  const queryClient = useQueryClient();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);

  const { currentRoute, streamingSlots, isStreaming, selectedDay, setSelectedDay, toggleSlotPin, removeSlot } =
    useRouteStore();

  // 스트리밍 완료 시점 감지 → 저장 완료 토스트
  const [showSavedToast, setShowSavedToast] = useState(false);
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setShowSavedToast(true);
      const timer = setTimeout(() => setShowSavedToast(false), 2500);
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const destination = currentRoute?.destination ?? '';

  // 날씨 fetch (스트리밍 완료 + 목적지 확정 후)
  const { data: weatherData } = useQuery({
    queryKey: ['weather', destination],
    queryFn: () => fetchCurrentWeather(destination),
    enabled: !!destination && !isStreaming,
    staleTime: 1000 * 60 * 30,
  });

  // 스트리밍 완료 후 API에서 슬롯 로드
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

  // 선택된 날 예상 비용 (Planner 모드 헤더용)
  const dayBudget = hasApiSlots
    ? currentDayApiSlots.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0)
    : 0;

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
      // 핀 토글 실패 시 무시
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

  // ─── Planner 모드: 스트리밍 중 또는 API 슬롯 미로드 ───────────────────────
  if (isStreaming || !hasApiSlots) {
    return (
      <View className="flex-1 bg-sky-50">
        {/* 지도 배경 (상단 45%) */}
        <View style={{ height: SCREEN_HEIGHT * 0.45 }}>
          {/* 스트리밍 완료 후 좌표 있으면 실제 지도, 없으면 점 패턴 배경 */}
          {hasApiSlots ? (
            <TripMap
              slots={apiSlots}
              selectedDay={selectedDay}
              height={SCREEN_HEIGHT * 0.45}
              focusedSlotId={focusedSlotId ?? undefined}
            />
          ) : (
            <View className="flex-1 bg-sky-100 items-center justify-center">
              <ActivityIndicator color="#0ea5e9" size="large" />
            </View>
          )}

          {/* 지도 위 플로팅 헤더 */}
          <View className="absolute top-0 left-0 right-0 z-20 p-6 flex-row justify-between items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 bg-white/90 rounded-full items-center justify-center shadow-sm"
            >
              <ChevronLeft size={24} color="#334155" />
            </TouchableOpacity>

            <View className="bg-white/90 px-5 py-2 rounded-2xl items-center shadow-sm">
              <View className="flex-row items-center gap-1">
                <Text className="font-bold text-slate-800 text-[15px]">
                  {destination || '루트 생성 중'}
                </Text>
                {isStreaming && <Sparkles size={13} color="#0ea5e9" />}
              </View>
              {currentRoute && (
                <Text className="text-[10px] font-bold text-slate-500">
                  {currentRoute.startDate} ~ {currentRoute.endDate}
                </Text>
              )}
            </View>

            <TouchableOpacity className="w-10 h-10 bg-white/90 rounded-full items-center justify-center shadow-sm">
              <Settings2 size={20} color="#334155" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 바텀 시트 */}
        <View
          className="flex-1 bg-white z-20"
          style={{ borderTopLeftRadius: 40, borderTopRightRadius: 40, marginTop: -32, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 40, elevation: 20 }}
        >
          {/* 드래그 핸들 */}
          <View className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mt-4 mb-2" />

          {/* 바텀시트 헤더 */}
          <View className="px-6 py-4 border-b border-slate-100 flex-row justify-between items-center">
            <View>
              <View className="flex-row items-center gap-2">
                <Text className="text-xl font-black text-slate-800">{selectedDay}일차 타임라인</Text>
                {dayBudget > 0 && (
                  <View className="bg-sky-50 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                    <Wallet size={11} color="#0ea5e9" />
                    <Text className="text-sky-600 text-[10px] font-bold">
                      예상 {dayBudget >= 10000 ? `약 ${Math.round(dayBudget / 10000)}만원` : `${dayBudget.toLocaleString()}원`}
                    </Text>
                  </View>
                )}
                {isStreaming && (
                  <ActivityIndicator size="small" color="#0ea5e9" />
                )}
              </View>
              <Text className="text-xs text-slate-500 font-medium mt-1">
                마음에 드는 일정은 핀으로 고정하세요
              </Text>
            </View>
          </View>

          {/* Day 탭 (스트리밍 중 다중 날인 경우) */}
          {days.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="px-6 pt-3"
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
          )}

          {/* 슬롯 리스트 (edit 모드) */}
          <ScrollView
            className="flex-1 px-6"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-4 pb-16 pt-4"
          >
            {hasApiSlots ? (
              currentDayApiSlots.map((apiSlot, i) => (
                <SlotCard
                  key={apiSlot.id}
                  slot={null}
                  apiSlot={apiSlot}
                  index={i}
                  isLast={i === currentDayApiSlots.length - 1}
                  routeId={routeId}
                  budgetLevel={(budgetLevel ?? 'mid') as BudgetLevel}
                  viewMode="edit"
                  onPin={() => handlePin(apiSlot.id)}
                  onRemove={() => handleDelete(apiSlot.id)}
                  onReplaceWithAlternative={(alt) => handleReplaceWithAlternative(apiSlot.id, alt)}
                  onTap={() => {
                    setFocusedSlotId(apiSlot.id);
                    setSelectedPlaceId(apiSlot.placeId);
                  }}
                />
              ))
            ) : (
              currentDayStreamSlots.map((slot, i) => (
                <SlotCard
                  key={`${slot.day}-${slot.order}`}
                  slot={slot}
                  index={i}
                  isLast={i === currentDayStreamSlots.length - 1}
                  viewMode="edit"
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

            {slotsLoading && !isStreaming && (
              <View className="items-center py-4">
                <ActivityIndicator color="#0ea5e9" />
              </View>
            )}
          </ScrollView>
        </View>

        <PlaceDetailSheet placeId={selectedPlaceId} onClose={() => setSelectedPlaceId(null)} />

        {showSavedToast && (
          <View className="absolute bottom-8 left-6 right-6 bg-slate-800 rounded-2xl px-5 py-3.5 flex-row items-center gap-2.5 shadow-lg z-50">
            <CheckCircle size={18} color="#22c55e" />
            <Text className="text-white font-semibold text-sm">루트가 저장됐어요</Text>
          </View>
        )}
      </View>
    );
  }

  // ─── Itinerary 모드: API 슬롯 로드 완료 ─────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* 스티키 헤더 */}
      <View className="px-6 pt-2 pb-4 bg-white shadow-sm" style={{ borderBottomLeftRadius: 40, borderBottomRightRadius: 40 }}>
        {/* 뒤로가기 + 제목 + 설정 */}
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity onPress={() => router.back()}>
            <ChevronLeft size={24} color="#475569" />
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-xl font-black text-slate-800">상세 일정</Text>
            {currentRoute && (
              <Text className="text-xs text-slate-500">
                {destination} · {currentRoute.startDate} ~ {currentRoute.endDate}
              </Text>
            )}
          </View>
          <TouchableOpacity>
            <Settings2 size={22} color="#475569" />
          </TouchableOpacity>
        </View>

        {/* DayTabs (itinerary variant: Day 탭 + 아이콘 요약 카드) */}
        <DayTabs
          slots={apiSlots}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          weather={weatherData}
          variant="itinerary"
        />
      </View>

      {/* 타임라인 (Itinerary 스타일) */}
      <ScrollView
        className="flex-1 px-6 pt-6"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-20"
      >
        {currentDayApiSlots.length === 0 ? (
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
              budgetLevel={(budgetLevel ?? 'mid') as BudgetLevel}
              viewMode="detail"
              onPin={() => handlePin(apiSlot.id)}
              onRemove={() => handleDelete(apiSlot.id)}
              onReplaceWithAlternative={(alt) => handleReplaceWithAlternative(apiSlot.id, alt)}
              onTap={() => {
                setFocusedSlotId(apiSlot.id);
                setSelectedPlaceId(apiSlot.placeId);
              }}
            />
          ))
        )}
      </ScrollView>

      <PlaceDetailSheet placeId={selectedPlaceId} onClose={() => setSelectedPlaceId(null)} />

      {showSavedToast && (
        <View className="absolute bottom-8 left-6 right-6 bg-slate-800 rounded-2xl px-5 py-3.5 flex-row items-center gap-2.5 shadow-lg z-50">
          <CheckCircle size={18} color="#22c55e" />
          <Text className="text-white font-semibold text-sm">루트가 저장됐어요</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

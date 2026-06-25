import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft, Settings2, Sparkles } from 'lucide-react-native';
import { useRouteStore } from '@/stores/useRouteStore';
import { SlotCard } from '@/components/route/SlotCard';

export default function RouteResultScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const { currentRoute, streamingSlots, isStreaming, selectedDay, setSelectedDay, toggleSlotPin, removeSlot } =
    useRouteStore();

  const slots = currentRoute?.slots ?? streamingSlots;
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const currentDaySlots = slots.filter((s) => s.day === selectedDay);

  const totalBudget = currentDaySlots.reduce((sum, s) => sum + (s.budget_estimate ?? 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* 헤더 */}
      <View className="flex-row justify-between items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="items-center">
          <View className="flex-row items-center gap-1">
            <Text className="font-bold text-slate-800 text-base">
              {currentRoute?.destination ?? '루트 생성 중'}
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

      {/* 스트리밍 중 안내 배너 */}
      {isStreaming && (
        <View className="mx-6 mb-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#0ea5e9" />
          <Text className="text-sky-700 text-sm font-medium">AI가 루트를 생성하고 있어요...</Text>
        </View>
      )}

      {/* Day 탭 */}
      {days.length > 0 && (
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
                selectedDay === day
                  ? 'bg-sky-500 border-sky-500'
                  : 'bg-white border-slate-200'
              }`}
            >
              <Text className={`font-bold text-sm ${selectedDay === day ? 'text-white' : 'text-slate-600'}`}>
                {day}일차
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 예상 예산 */}
      {currentDaySlots.length > 0 && (
        <View className="mx-6 mb-3 flex-row justify-between items-center">
          <Text className="text-sm font-bold text-slate-700">{selectedDay}일차 타임라인</Text>
          <View className="bg-sky-50 px-3 py-1 rounded-full">
            <Text className="text-sky-600 text-xs font-bold">
              예상 {totalBudget.toLocaleString()}원
            </Text>
          </View>
        </View>
      )}

      {/* 슬롯 목록 */}
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-4 pb-8"
      >
        {currentDaySlots.length === 0 && !isStreaming ? (
          <View className="items-center justify-center py-20">
            <Text className="text-slate-400 font-medium">슬롯이 없습니다</Text>
          </View>
        ) : (
          currentDaySlots.map((slot, i) => (
            <SlotCard
              key={`${slot.day}-${slot.order}`}
              slot={slot}
              index={i}
              isLast={i === currentDaySlots.length - 1}
              onPin={() => toggleSlotPin(slot.day, slot.order)}
              onReshuffle={() => {
                // TODO: 리셔플 API 연동
              }}
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
    </SafeAreaView>
  );
}

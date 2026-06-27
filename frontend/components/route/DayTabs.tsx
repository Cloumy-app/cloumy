import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import type { SlotWithCoords } from '@/types';

interface DayTabsProps {
  slots: SlotWithCoords[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

export function DayTabs({ slots, selectedDay, onSelectDay }: DayTabsProps) {
  const days = [...new Set(slots.map((s) => s.dayNumber))].sort();

  const dayBudget = slots
    .filter((s) => s.dayNumber === selectedDay)
    .reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  const daySlotCount = slots.filter((s) => s.dayNumber === selectedDay).length;

  return (
    <View>
      {/* Day 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-6 py-2"
        contentContainerClassName="gap-2"
      >
        {days.map((day) => (
          <TouchableOpacity
            key={day}
            onPress={() => onSelectDay(day)}
            className={`px-4 py-2 rounded-full border ${
              selectedDay === day ? 'bg-sky-500 border-sky-500' : 'bg-white border-slate-200'
            }`}
          >
            <Text
              className={`font-bold text-sm ${
                selectedDay === day ? 'text-white' : 'text-slate-600'
              }`}
            >
              {day}일차
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 요약 카드 */}
      {daySlotCount > 0 && (
        <View className="flex-row gap-2 px-6 pb-2">
          <View className="flex-1 bg-sky-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-sky-600 font-black text-base">
              {dayBudget > 0 ? `${Math.round(dayBudget / 1000)}K` : '-'}
            </Text>
            <Text className="text-slate-500 text-[10px] font-medium">예상비용</Text>
          </View>
          <View className="flex-1 bg-emerald-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-emerald-600 font-black text-base">{daySlotCount}</Text>
            <Text className="text-slate-500 text-[10px] font-medium">방문장소</Text>
          </View>
          <View className="flex-1 bg-amber-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-amber-600 font-black text-base">{selectedDay}일차</Text>
            <Text className="text-slate-500 text-[10px] font-medium">현재 일정</Text>
          </View>
        </View>
      )}
    </View>
  );
}

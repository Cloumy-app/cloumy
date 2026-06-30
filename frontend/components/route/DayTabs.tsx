import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Wallet, MapPin, CloudSun } from 'lucide-react-native';
import type { SlotWithCoords } from '@/types';
import type { WeatherInfo } from '@/lib/api/weather';

interface DayTabsProps {
  slots: SlotWithCoords[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  weather?: WeatherInfo | null;
  variant?: 'planner' | 'itinerary';
}

function formatBudget(won: number): string {
  if (won <= 0) return '-';
  if (won >= 10000) return `약 ${Math.round(won / 10000)}만원`;
  return `${won.toLocaleString()}원`;
}

export function DayTabs({ slots, selectedDay, onSelectDay, weather, variant = 'planner' }: DayTabsProps) {
  const days = [...new Set(slots.map((s) => s.dayNumber))].sort();

  const dayBudget = slots
    .filter((s) => s.dayNumber === selectedDay)
    .reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  const totalBudget = slots.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
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
            className={`px-5 py-2.5 rounded-2xl border ${
              selectedDay === day ? 'bg-sky-500 border-sky-500 shadow-md' : 'bg-slate-100 border-transparent'
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
      {daySlotCount > 0 && variant === 'itinerary' && (
        <View className="flex-row gap-2 px-6 pb-2">
          {/* 예상 비용 */}
          <View className="flex-1 bg-sky-50 rounded-xl p-3 items-center justify-center border border-sky-100">
            <Wallet size={16} color="#0ea5e9" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">예상 비용</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
              {formatBudget(dayBudget)}
            </Text>
          </View>

          {/* 방문 장소 */}
          <View className="flex-1 bg-emerald-50 rounded-xl p-3 items-center justify-center border border-emerald-100">
            <MapPin size={16} color="#10b981" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">방문 장소</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5">{daySlotCount}곳</Text>
          </View>

          {/* 날씨 or 총 예산 */}
          {weather ? (
            <View className="flex-1 bg-amber-50 rounded-xl p-3 items-center justify-center border border-amber-100">
              <CloudSun size={16} color="#f59e0b" />
              <Text className="text-[10px] text-slate-500 font-medium mt-1">날씨</Text>
              <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
                {weather.description} {weather.temp}°
              </Text>
            </View>
          ) : (
            <View className="flex-1 bg-violet-50 rounded-xl p-3 items-center justify-center border border-violet-100">
              <Wallet size={16} color="#8b5cf6" />
              <Text className="text-[10px] text-slate-500 font-medium mt-1">총 예산</Text>
              <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
                {formatBudget(totalBudget)}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* planner variant: 기존 스타일 */}
      {daySlotCount > 0 && variant === 'planner' && (
        <View className="flex-row gap-2 px-6 pb-2">
          <View className="flex-1 bg-sky-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-sky-600 font-black text-base" numberOfLines={1}>
              {formatBudget(dayBudget)}
            </Text>
            <Text className="text-slate-500 text-[10px] font-medium">일별 예상비용</Text>
          </View>
          <View className="flex-1 bg-emerald-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-emerald-600 font-black text-base">{daySlotCount}곳</Text>
            <Text className="text-slate-500 text-[10px] font-medium">방문장소</Text>
          </View>
          {weather ? (
            <View className="flex-1 bg-amber-50 rounded-xl px-3 py-2 items-center">
              <Text className="text-amber-600 font-black text-base" numberOfLines={1}>
                {weather.description} {weather.temp}°
              </Text>
              <Text className="text-slate-500 text-[10px] font-medium">현재 날씨</Text>
            </View>
          ) : (
            <View className="flex-1 bg-violet-50 rounded-xl px-3 py-2 items-center">
              <Text className="text-violet-600 font-black text-base" numberOfLines={1}>
                {formatBudget(totalBudget)}
              </Text>
              <Text className="text-slate-500 text-[10px] font-medium">여행 총 예산</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

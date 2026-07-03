import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Wallet, MapPin, CloudSun } from 'lucide-react-native';
import type { SlotWithCoords } from '@/types';
import type { WeatherInfo } from '@/lib/api/weather';

interface DayTabsProps {
  slots: SlotWithCoords[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  weatherByDate?: Record<string, WeatherInfo>;
  startDate?: string;
  variant?: 'planner' | 'itinerary';
}

function formatBudget(won: number): string {
  if (won <= 0) return '-';
  if (won >= 10000) return `약 ${Math.round(won / 10000)}만원`;
  return `${won.toLocaleString()}원`;
}

function getDateForDay(startDate: string, dayNumber: number): string {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayNumber - 1);
  return date.toISOString().split('T')[0];
}

export function DayTabs({ slots, selectedDay, onSelectDay, weatherByDate, startDate, variant = 'planner' }: DayTabsProps) {
  const days = [...new Set(slots.map((s) => s.dayNumber))].sort();

  const dayBudget = slots
    .filter((s) => s.dayNumber === selectedDay)
    .reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  const daySlotCount = slots.filter((s) => s.dayNumber === selectedDay).length;

  const currentDateStr = startDate ? getDateForDay(startDate, selectedDay) : null;
  const weather = currentDateStr && weatherByDate ? weatherByDate[currentDateStr] ?? null : null;

  return (
    <View>
      {/* Day 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-6 py-2"
        contentContainerStyle={{ gap: 8 }}
      >
        {days.map((day) => (
          <TouchableOpacity
            key={day}
            onPress={() => onSelectDay(day)}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 16,
              borderWidth: 1,
              backgroundColor: selectedDay === day ? '#0ea5e9' : '#f1f5f9',
              borderColor: selectedDay === day ? '#0ea5e9' : 'transparent',
            }}
          >
            <Text
              style={{
                fontWeight: '700',
                fontSize: 14,
                color: selectedDay === day ? '#ffffff' : '#475569',
              }}
            >
              {day}일차
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 요약 카드 */}
      {daySlotCount > 0 && variant === 'itinerary' && (
        <View className="flex-row gap-2 px-6 pb-2">
          <View className="flex-1 bg-sky-50 rounded-xl p-3 items-center justify-center border border-sky-100">
            <Wallet size={16} color="#0ea5e9" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">예상 비용</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
              {formatBudget(dayBudget)}
            </Text>
          </View>

          <View className="flex-1 bg-emerald-50 rounded-xl p-3 items-center justify-center border border-emerald-100">
            <MapPin size={16} color="#10b981" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">방문 장소</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5">{daySlotCount}곳</Text>
          </View>

          {weather ? (
            <View className="flex-1 bg-amber-50 rounded-xl p-3 items-center justify-center border border-amber-100">
              <CloudSun size={16} color="#f59e0b" />
              <Text className="text-[10px] text-slate-500 font-medium mt-1">날씨</Text>
              <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
                {weather.description} {weather.temp}°
              </Text>
            </View>
          ) : (
            <View className="flex-1 bg-slate-50 rounded-xl p-3 items-center justify-center border border-slate-100">
              <CloudSun size={16} color="#94a3b8" />
              <Text className="text-[10px] text-slate-400 font-medium mt-1">날씨</Text>
              <Text className="text-xs font-black text-slate-400 mt-0.5" numberOfLines={1}>
                정보 없음
              </Text>
            </View>
          )}
        </View>
      )}

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
              <Text className="text-slate-500 text-[10px] font-medium">여행 날씨</Text>
            </View>
          ) : (
            <View className="flex-1 bg-slate-50 rounded-xl px-3 py-2 items-center">
              <Text className="text-slate-400 font-black text-base" numberOfLines={1}>
                정보 없음
              </Text>
              <Text className="text-slate-400 text-[10px] font-medium">여행 날씨</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

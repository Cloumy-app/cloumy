import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Wallet, MapPin, CloudSun, Sun, Cloud, CloudRain } from 'lucide-react-native';
import type { SlotWithCoords } from '@/types';
import type { DayWeather } from '@/lib/api/weather';
import { isWithinForecastRange, isPastDate } from '@/lib/api/weather';

interface DayTabsProps {
  slots: SlotWithCoords[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  weatherByDate?: Record<string, DayWeather>;
  startDate?: string;
  variant?: 'planner' | 'itinerary';
}

function formatBudget(t: TFunction, won: number): string {
  if (won <= 0) return '-';
  if (won >= 10000) return t('routeResult.budgetApprox', { amount: Math.round(won / 10000) });
  return t('routeResult.budgetExact', { amount: won.toLocaleString() });
}

function getDateForDay(startDate: string, dayNumber: number): string {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayNumber - 1);
  return date.toISOString().split('T')[0];
}

const WEATHER_THEME = {
  sun:   { Icon: Sun,      bg: 'bg-amber-50',  text: 'text-amber-600', color: '#d97706' },
  cloud: { Icon: Cloud,    bg: 'bg-slate-100', text: 'text-slate-500', color: '#64748b' },
  rain:  { Icon: CloudRain, bg: 'bg-sky-50',   text: 'text-sky-600',   color: '#0284c7' },
} as const;

function getWeatherTheme(weather: DayWeather) {
  if (weather.rainyBlocks.length >= 2) return WEATHER_THEME.rain;
  if (weather.rainyBlocks.length === 0 && weather.description === 'clear sky') return WEATHER_THEME.sun;
  return WEATHER_THEME.cloud;
}

export function DayTabs({ slots, selectedDay, onSelectDay, weatherByDate, startDate, variant = 'planner' }: DayTabsProps) {
  const { t } = useTranslation();
  const days = [...new Set(slots.map((s) => s.dayNumber))].sort();

  const dayBudget = slots
    .filter((s) => s.dayNumber === selectedDay)
    .reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  const daySlotCount = slots.filter((s) => s.dayNumber === selectedDay).length;

  const currentDateStr = startDate ? getDateForDay(startDate, selectedDay) : null;
  const weather = currentDateStr && weatherByDate ? weatherByDate[currentDateStr] ?? null : null;
  const isFutureOutOfRange = currentDateStr
    ? !isPastDate(currentDateStr) && !isWithinForecastRange(currentDateStr)
    : false;
  const tripEndDateStr = startDate && days.length > 0 ? getDateForDay(startDate, days[days.length - 1]) : null;
  const isTripEnded = tripEndDateStr ? isPastDate(tripEndDateStr) : false;

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
              {t('routeResult.dayTabLabel', { day })}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 요약 카드 */}
      {daySlotCount > 0 && variant === 'itinerary' && (
        <View className="flex-row gap-2 px-6 pb-2">
          <View className="flex-1 bg-sky-50 rounded-xl p-3 items-center justify-center border border-sky-100">
            <Wallet size={16} color="#0ea5e9" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">{t('dayTabs.estimatedCostLabel')}</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
              {formatBudget(t, dayBudget)}
            </Text>
          </View>

          <View className="flex-1 bg-emerald-50 rounded-xl p-3 items-center justify-center border border-emerald-100">
            <MapPin size={16} color="#10b981" />
            <Text className="text-[10px] text-slate-500 font-medium mt-1">{t('dayTabs.visitedPlacesLabel')}</Text>
            <Text className="text-xs font-black text-slate-800 mt-0.5">{t('dayTabs.placesCount', { count: daySlotCount })}</Text>
          </View>

          {!isTripEnded && (weather ? (
            <View className="flex-1 bg-amber-50 rounded-xl p-3 items-center justify-center border border-amber-100">
              <CloudSun size={16} color="#f59e0b" />
              <Text className="text-[10px] text-slate-500 font-medium mt-1">{t('dayTabs.weatherLabel')}</Text>
              <Text className="text-xs font-black text-slate-800 mt-0.5" numberOfLines={1}>
                {t(`weather.conditions.${weather.description}`, { defaultValue: weather.description })} {weather.temp}°
              </Text>
              {weather.rainyBlocks.length > 0 && weather.rainyBlocks.length < 3 && (
                <Text className="text-[9px] text-sky-600 font-bold mt-0.5" numberOfLines={1}>
                  {t('weather.rainBlocksSuffix', {
                    blocks: weather.rainyBlocks.map((b) => t(`weather.blocks.${b}`)).join('·'),
                  })}
                </Text>
              )}
            </View>
          ) : (
            <View className="flex-1 bg-slate-50 rounded-xl p-3 items-center justify-center border border-slate-100">
              <CloudSun size={16} color="#94a3b8" />
              <Text className="text-[10px] text-slate-400 font-medium mt-1">{t('dayTabs.weatherLabel')}</Text>
              <Text className="text-xs font-black text-slate-400 mt-0.5" numberOfLines={1}>
                {isFutureOutOfRange ? t('weather.forecastRangeHint') : t('weather.noInfo')}
              </Text>
            </View>
          ))}
        </View>
      )}

      {daySlotCount > 0 && variant === 'planner' && (
        <View className="flex-row gap-2 px-6 pb-2">
          <View className="flex-1 bg-sky-50 rounded-xl px-3 py-2 items-center justify-center">
            <Text className="text-sky-600 font-black text-base" numberOfLines={1}>
              {formatBudget(t, dayBudget)}
            </Text>
            <Text className="text-slate-500 text-[10px] font-medium">{t('dayTabs.dailyBudgetLabel')}</Text>
          </View>
          <View className="flex-1 bg-emerald-50 rounded-xl px-3 py-2 items-center justify-center">
            <Text className="text-emerald-600 font-black text-base">{t('dayTabs.placesCount', { count: daySlotCount })}</Text>
            <Text className="text-slate-500 text-[10px] font-medium">{t('dayTabs.visitedPlacesShortLabel')}</Text>
          </View>
          {!isTripEnded && (weather ? (() => {
            const theme = getWeatherTheme(weather);
            return (
              <View className={`flex-1 ${theme.bg} rounded-xl px-3 py-2 items-center justify-center`}>
                <Text className={`${theme.text} font-black text-base`} numberOfLines={1}>
                  {t(`weather.conditions.${weather.description}`, { defaultValue: weather.description })} {weather.temp}°
                </Text>
                <theme.Icon size={14} color={theme.color} />
                {weather.rainyBlocks.length > 0 && weather.rainyBlocks.length < 3 && (
                  <Text className="text-sky-600 text-[9px] font-bold" numberOfLines={1}>
                    {t('weather.rainBlocksSuffix', {
                      blocks: weather.rainyBlocks.map((b) => t(`weather.blocks.${b}`)).join('·'),
                    })}
                  </Text>
                )}
              </View>
            );
          })() : (
            <View className="flex-1 bg-slate-50 rounded-xl px-3 py-2 items-center justify-center">
              <Text className="text-slate-400 font-black text-base" numberOfLines={1}>
                {isFutureOutOfRange ? t('weather.forecastRangeHint') : t('weather.noInfo')}
              </Text>
              <Text className="text-slate-400 text-[10px] font-medium">{t('dayTabs.tripWeatherLabel')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, MapPin, Calendar, X } from 'lucide-react-native';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { createManualRoute } from '@/lib/api/routes';
import { useImportedSlotsStore } from '@/stores/useImportedSlotsStore';
import { SearchPlaceTab } from '@/components/route/SearchPlaceTab';

// step-1.tsx의 CITIES와 동일한 목적지 프리셋(도메인 전제가 국내 도시 한정이라 여기서도 동일 목록 사용)
const CITIES = ['서울', '부산', '제주', '경주', '강릉', '전주', '여수', '속초', '춘천', '거제'];

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(d);
}

export default function CommunityCreateRouteScreen() {
  const { t, i18n } = useTranslation();
  const { slots, removeSlot, clear } = useImportedSlotsStore();

  // 이전 위저드 세션에서 남은 잔여 슬롯이 섞여 들어가지 않도록 진입 시 초기화
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [tempStartDate, setTempStartDate] = useState(new Date());
  const [tempEndDate, setTempEndDate] = useState(new Date());
  const [submitting, setSubmitting] = useState(false);

  const minEndDate = useMemo(() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 1);
    return d;
  }, [startDate]);

  const handleStartConfirm = () => {
    setStartDate(tempStartDate);
    if (tempStartDate >= endDate) {
      const next = new Date(tempStartDate);
      next.setDate(next.getDate() + 1);
      setEndDate(next);
    }
    setShowStartPicker(false);
  };

  const handleEndConfirm = () => {
    setEndDate(tempEndDate);
    setShowEndPicker(false);
  };

  const nights = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const dayCount = nights + 1;

  const slotsByDay = useMemo(() => {
    const grouped: Record<number, typeof slots> = {};
    slots.forEach((s) => {
      grouped[s.dayNumber] = grouped[s.dayNumber] ?? [];
      grouped[s.dayNumber].push(s);
    });
    return grouped;
  }, [slots]);

  const canSubmit = title.trim().length > 0 && destination.length > 0 && slots.length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createManualRoute({
        title: title.trim(),
        destination,
        startDate: toDateStr(startDate),
        endDate: toDateStr(endDate),
        slots: slots.map((s) => ({ placeId: s.placeId, dayNumber: s.dayNumber })),
      });
      clear();
      router.replace('/(tabs)/community');
    } catch {
      Alert.alert(t('communityCreate.publishFailedTitle'), t('communityCreate.publishFailedBody'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800 flex-1">{t('communityCreate.headerTitle')}</Text>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 제목 */}
        <View className="mb-6">
          <Text className="font-bold text-slate-700 mb-3">{t('communityCreate.titleLabel')}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('communityCreate.titlePlaceholder')}
            className="bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700"
          />
        </View>

        {/* 목적지 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <MapPin size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">{t('communityCreate.destinationLabel')}</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {CITIES.map((city) => (
              <TouchableOpacity
                key={city}
                onPress={() => setDestination(city)}
                className={`px-4 py-2.5 rounded-2xl border-2 ${
                  destination === city ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                }`}
              >
                <Text className={`font-semibold text-sm ${destination === city ? 'text-sky-600' : 'text-slate-600'}`}>
                  {t(`routeCreateStep1.cities.${city}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 날짜 범위 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <Calendar size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">{t('communityCreate.dateRangeLabel')}</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => {
                setTempStartDate(startDate);
                setShowStartPicker(true);
              }}
              className="flex-1 bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-sky-400 mb-0.5">{t('routeCreateStep1.startDateLabel')}</Text>
              <Text className="text-sm font-bold text-sky-700" numberOfLines={1}>
                {formatDisplayDate(startDate, i18n.language)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setTempEndDate(endDate);
                setShowEndPicker(true);
              }}
              className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-slate-400 mb-0.5">{t('routeCreateStep1.endDateLabel')}</Text>
              <Text className="text-sm font-bold text-slate-700" numberOfLines={1}>
                {formatDisplayDate(endDate, i18n.language)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 장소 추가 */}
        <View className="mb-4">
          <Text className="font-bold text-slate-700 mb-3">{t('communityCreate.addPlaceLabel')}</Text>
        </View>
      </ScrollView>

      <View style={{ height: 260 }}>
        <SearchPlaceTab dayCount={dayCount} />
      </View>

      {slots.length > 0 && (
        <ScrollView className="px-6" style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
          {Object.keys(slotsByDay)
            .map(Number)
            .sort((a, b) => a - b)
            .map((day) => (
              <View key={day} className="mb-2">
                <Text className="text-xs font-bold text-slate-400 mb-1">{t('routeCreateImport.dayChip', { day })}</Text>
                {slotsByDay[day].map((s) => (
                  <View key={s.placeId} className="flex-row items-center justify-between bg-slate-50 rounded-xl px-3 py-2 mb-1">
                    <Text className="text-sm font-semibold text-slate-700 flex-1" numberOfLines={1}>{s.placeName}</Text>
                    <TouchableOpacity onPress={() => removeSlot(s.placeId)}>
                      <X size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ))}
        </ScrollView>
      )}

      <View className="px-6 py-4">
        <TouchableOpacity
          onPress={onSubmit}
          disabled={!canSubmit}
          className={`py-4 rounded-2xl items-center ${canSubmit ? 'bg-sky-500' : 'bg-slate-200'}`}
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className={`font-bold text-base ${canSubmit ? 'text-white' : 'text-slate-400'}`}>
              {t('communityCreate.publishButton')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 출발일 피커 모달 */}
      <Modal visible={showStartPicker} transparent animationType="slide">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setShowStartPicker(false)} />
        <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
          <View className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
          <Text className="text-base font-bold text-slate-800 mb-3">{t('routeCreateStep1.selectStartDate')}</Text>
          <DateTimePicker
            value={tempStartDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onValueChange={(_, date) => {
              if (date) setTempStartDate(date);
            }}
          />
          <TouchableOpacity onPress={handleStartConfirm} className="bg-sky-500 py-4 rounded-2xl items-center mt-4">
            <Text className="text-white font-bold text-base">{t('routeCreateStep1.confirmButton')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 도착일 피커 모달 */}
      <Modal visible={showEndPicker} transparent animationType="slide">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setShowEndPicker(false)} />
        <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
          <View className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
          <Text className="text-base font-bold text-slate-800 mb-3">{t('routeCreateStep1.selectEndDate')}</Text>
          <DateTimePicker
            value={tempEndDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={minEndDate}
            onValueChange={(_, date) => {
              if (date) setTempEndDate(date);
            }}
          />
          <TouchableOpacity onPress={handleEndConfirm} className="bg-sky-500 py-4 rounded-2xl items-center mt-4">
            <Text className="text-white font-bold text-base">{t('routeCreateStep1.confirmButton')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

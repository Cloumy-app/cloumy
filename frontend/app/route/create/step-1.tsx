import { View, Text, TouchableOpacity, ScrollView, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router } from 'expo-router';
import { ChevronLeft, MapPin, Users, Calendar, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@expo/ui/community/datetime-picker';

const CITIES = ['서울', '부산', '제주', '경주', '강릉', '전주', '여수', '속초', '춘천', '거제'];
const GROUP_TYPE_VALUES = ['solo', 'couple', 'friends', 'family'] as const;

interface Step1Form {
  destination: string;
  groupType: (typeof GROUP_TYPE_VALUES)[number];
}

function buildStep1Schema(t: (key: string) => string) {
  return z.object({
    destination: z.string().min(1, t('routeCreateStep1.destinationRequired')),
    groupType: z.enum(['solo', 'couple', 'friends', 'family']),
  });
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(d);
}

export default function RouteCreateStep1() {
  const { t, i18n } = useTranslation();
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [tempStartDate, setTempStartDate] = useState(new Date());
  const [tempEndDate, setTempEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });

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

  const nights = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const minEndDate = new Date(startDate);
  minEndDate.setDate(minEndDate.getDate() + 1);

  const step1Schema = useMemo(() => buildStep1Schema(t), [t]);
  const { control, handleSubmit, formState: { errors } } = useForm<Step1Form>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      destination: '',
      groupType: 'friends',
    },
  });

  const onNext = (data: Step1Form) => {
    router.push({
      pathname: '/route/create/step-2',
      params: { ...data, startDate: toDateStr(startDate), endDate: toDateStr(endDate), nights },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* 헤더 */}
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 1 / 4</Text>
          <Text className="text-xl font-bold text-slate-800">{t('routeCreateStep1.headerTitle')}</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <MapPin size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">{t('routeCreateStep1.destinationLabel')}</Text>
          </View>
          <Controller
            control={control}
            name="destination"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row flex-wrap gap-2">
                {CITIES.map((city) => (
                  <TouchableOpacity
                    key={city}
                    onPress={() => onChange(city)}
                    className={`px-4 py-2.5 rounded-2xl border-2 ${
                      value === city
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text
                      className={`font-semibold text-sm ${
                        value === city ? 'text-sky-600' : 'text-slate-600'
                      }`}
                    >
                      {t(`routeCreateStep1.cities.${city}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
          {errors.destination && (
            <Text className="text-rose-500 text-xs mt-2">{errors.destination.message}</Text>
          )}
        </View>

        {/* 여행 기간 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <Calendar size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">{t('routeCreateStep1.tripDurationLabel')}</Text>
          </View>

          {/* 날짜 선택 버튼 행 */}
          <View className="flex-row items-center gap-2">
            {/* 출발일 버튼 */}
            <TouchableOpacity
              onPress={() => setShowStartPicker(true)}
              activeOpacity={0.8}
              className="flex-1 bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-sky-400 mb-0.5">{t('routeCreateStep1.startDateLabel')}</Text>
              <Text className="text-sm font-bold text-sky-700" numberOfLines={1}>
                {formatDisplayDate(startDate, i18n.language)}
              </Text>
            </TouchableOpacity>

            <ChevronRight size={16} color="#94a3b8" />

            {/* 도착일 버튼 */}
            <TouchableOpacity
              onPress={() => setShowEndPicker(true)}
              activeOpacity={0.8}
              className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-slate-400 mb-0.5">{t('routeCreateStep1.endDateLabel')}</Text>
              <Text className="text-sm font-bold text-slate-700" numberOfLines={1}>
                {formatDisplayDate(endDate, i18n.language)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 박수 뱃지 */}
          <View className="items-center mt-3">
            <View className="bg-sky-500 px-5 py-1.5 rounded-full">
              <Text className="text-white font-bold text-sm">
                {t('routeCreateStep1.nightsBadge', { nights, days: nights + 1 })}
              </Text>
            </View>
          </View>

          {/* 출발일 피커 모달 */}
          <Modal
            visible={showStartPicker}
            transparent
            animationType="slide"
            onShow={() => setTempStartDate(startDate)}
          >
            <TouchableOpacity
              className="flex-1"
              activeOpacity={1}
              onPress={() => setShowStartPicker(false)}
            />
            <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
              <View className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <Text className="text-base font-bold text-slate-800 mb-3">{t('routeCreateStep1.selectStartDate')}</Text>
              <DateTimePicker
                value={tempStartDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={new Date()}
                onValueChange={(_, date) => {
                  if (date) setTempStartDate(date);
                }}
              />
              <TouchableOpacity
                onPress={handleStartConfirm}
                className="bg-sky-500 py-4 rounded-2xl items-center mt-4"
              >
                <Text className="text-white font-bold text-base">{t('routeCreateStep1.confirmButton')}</Text>
              </TouchableOpacity>
            </View>
          </Modal>

          {/* 도착일 피커 모달 */}
          <Modal
            visible={showEndPicker}
            transparent
            animationType="slide"
            onShow={() => setTempEndDate(endDate)}
          >
            <TouchableOpacity
              className="flex-1"
              activeOpacity={1}
              onPress={() => setShowEndPicker(false)}
            />
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
              <TouchableOpacity
                onPress={handleEndConfirm}
                className="bg-sky-500 py-4 rounded-2xl items-center mt-4"
              >
                <Text className="text-white font-bold text-base">{t('routeCreateStep1.confirmButton')}</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </View>

        {/* 인원 유형 */}
        <View className="mb-8">
          <View className="flex-row items-center gap-2 mb-3">
            <Users size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">{t('routeCreateStep1.groupTypeLabel')}</Text>
          </View>
          <Controller
            control={control}
            name="groupType"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row gap-2">
                {GROUP_TYPE_VALUES.map((g) => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => onChange(g)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      value === g
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text className={`font-semibold text-sm ${value === g ? 'text-sky-600' : 'text-slate-500'}`}>
                      {t(`routeCreateStep1.groupTypes.${g}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
        </View>

        <View className="h-4" />
      </ScrollView>

      {/* 다음 버튼 */}
      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={handleSubmit(onNext)}
          className="bg-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          <Text className="text-white font-bold text-base">{t('routeCreateStep1.nextButton')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

import { View, Text, TouchableOpacity, ScrollView, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router } from 'expo-router';
import { ChevronLeft, MapPin, Users, Calendar, ChevronRight, Bus, Car, Footprints } from 'lucide-react-native';
import { useState } from 'react';
import DateTimePicker from '@expo/ui/community/datetime-picker';

const CITIES = ['서울', '부산', '제주', '경주', '강릉', '전주', '여수', '속초', '춘천', '거제'];
const GROUP_TYPES = [
  { value: 'solo', label: '혼자' },
  { value: 'couple', label: '커플' },
  { value: 'friends', label: '친구들' },
  { value: 'family', label: '가족' },
] as const;

// 여행 전체 기본 이동수단 — 선택 사항(안 골라도 다음 단계 진행 가능).
// 값이 있을 때만 이동시간 계산에 쓰이고, 대중교통은 Tmap 실API를 호출하므로
// 기본 선택값을 두지 않는다(사용자가 명시적으로 고를 때만 호출 발생).
const TRANSPORT_MODES = [
  { value: 'transit', label: '대중교통', Icon: Bus },
  { value: 'car', label: '자동차', Icon: Car },
  { value: 'walk', label: '도보', Icon: Footprints },
] as const;

const step1Schema = z.object({
  destination: z.string().min(1, '목적지를 선택해주세요'),
  groupType: z.enum(['solo', 'couple', 'friends', 'family']),
  transportMode: z.enum(['transit', 'car', 'walk']).optional(),
});

type Step1Form = z.infer<typeof step1Schema>;

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_LABELS[d.getDay()]})`;
}

export default function RouteCreateStep1() {
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
          <Text className="text-xl font-bold text-slate-800">어디로 떠날까요?</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <MapPin size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">목적지</Text>
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
                      {city}
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
            <Text className="font-bold text-slate-700">여행 기간</Text>
          </View>

          {/* 날짜 선택 버튼 행 */}
          <View className="flex-row items-center gap-2">
            {/* 출발일 버튼 */}
            <TouchableOpacity
              onPress={() => setShowStartPicker(true)}
              activeOpacity={0.8}
              className="flex-1 bg-sky-50 border-2 border-sky-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-sky-400 mb-0.5">출발일</Text>
              <Text className="text-sm font-bold text-sky-700" numberOfLines={1}>
                {formatDisplayDate(startDate)}
              </Text>
            </TouchableOpacity>

            <ChevronRight size={16} color="#94a3b8" />

            {/* 도착일 버튼 */}
            <TouchableOpacity
              onPress={() => setShowEndPicker(true)}
              activeOpacity={0.8}
              className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3"
            >
              <Text className="text-[10px] font-bold text-slate-400 mb-0.5">도착일</Text>
              <Text className="text-sm font-bold text-slate-700" numberOfLines={1}>
                {formatDisplayDate(endDate)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 박수 뱃지 */}
          <View className="items-center mt-3">
            <View className="bg-sky-500 px-5 py-1.5 rounded-full">
              <Text className="text-white font-bold text-sm">{nights}박 {nights + 1}일</Text>
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
              <Text className="text-base font-bold text-slate-800 mb-3">출발일 선택</Text>
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
                <Text className="text-white font-bold text-base">확인</Text>
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
              <Text className="text-base font-bold text-slate-800 mb-3">도착일 선택</Text>
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
                <Text className="text-white font-bold text-base">확인</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </View>

        {/* 인원 유형 */}
        <View className="mb-8">
          <View className="flex-row items-center gap-2 mb-3">
            <Users size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">누구와 함께?</Text>
          </View>
          <Controller
            control={control}
            name="groupType"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row gap-2">
                {GROUP_TYPES.map((g) => (
                  <TouchableOpacity
                    key={g.value}
                    onPress={() => onChange(g.value)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      value === g.value
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text className={`font-semibold text-sm ${value === g.value ? 'text-sky-600' : 'text-slate-500'}`}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
        </View>

        {/* 이동수단 (선택) */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-1">주로 어떻게 이동하세요?</Text>
          <Text className="text-xs text-slate-400 mb-4">선택하면 장소 사이 이동시간을 계산해드려요 (선택 사항)</Text>
          <Controller
            control={control}
            name="transportMode"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row gap-2">
                {TRANSPORT_MODES.map(({ value: modeValue, label, Icon }) => {
                  const selected = value === modeValue;
                  return (
                    <TouchableOpacity
                      key={modeValue}
                      onPress={() => onChange(selected ? undefined : modeValue)}
                      className={`flex-1 py-3 rounded-2xl border-2 items-center gap-1 ${
                        selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Icon size={18} color={selected ? '#0284c7' : '#94a3b8'} />
                      <Text className={`font-semibold text-sm ${selected ? 'text-sky-600' : 'text-slate-500'}`}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
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
          <Text className="text-white font-bold text-base">다음 단계</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

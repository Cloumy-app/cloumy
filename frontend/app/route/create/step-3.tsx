import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import type { BudgetLevel, Density } from '@/types';
import { BUDGET_LABEL } from '@/types';

const RATIO_OPTIONS = [
  { label: '관광지 위주', desc: '유명 명소 중심으로 알차게', ratio: 0.1 },
  { label: '혼합',       desc: '관광지와 숨은 명소 균형 있게', ratio: 0.5 },
  { label: '숨은 명소 위주', desc: '현지인만 아는 특별한 장소', ratio: 0.9 },
] as const;

const DENSITY_OPTIONS = [
  { label: '널널하게', desc: '여유롭게 하루 3곳 정도', density: 'relaxed' as const },
  { label: '보통',     desc: '하루 4~5곳, 기존과 동일', density: 'normal' as const },
  { label: '알차게',   desc: '하루 6곳까지 알차게 이동', density: 'packed' as const },
] as const;

export default function RouteCreateStep3() {
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
    tags: string;
    budgetLevel: string;
  }>();

  const [selectedRatio, setSelectedRatio] = useState(0.5);
  const [selectedDensity, setSelectedDensity] = useState<Density>('normal');

  const onNext = () => {
    router.push({
      pathname: '/route/create/step-4',
      params: {
        ...params,
        hiddenGemRatio: String(selectedRatio),
        density: selectedDensity,
      },
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
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 3 / 4</Text>
          <Text className="text-xl font-bold text-slate-800">어떤 장소를 원하세요?</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 요약 */}
        <View className="bg-sky-50 rounded-2xl px-4 py-3 mb-6 flex-row items-center gap-2">
          <Text className="text-sky-600 font-bold">{params.destination}</Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">{params.nights}박{Number(params.nights)+1}일</Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">{BUDGET_LABEL[(params.budgetLevel ?? 'mid') as BudgetLevel]}</Text>
        </View>

        {/* 장소 성향 선택 */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-1">장소 성향</Text>
          <Text className="text-xs text-slate-400 mb-4">AI가 후보 장소 중 비율을 맞춰 루트를 구성합니다</Text>
          <View className="gap-3">
            {RATIO_OPTIONS.map((option) => {
              const selected = selectedRatio === option.ratio;
              return (
                <TouchableOpacity
                  key={option.ratio}
                  onPress={() => setSelectedRatio(option.ratio)}
                  className={`flex-row items-center px-4 py-4 rounded-2xl border-2 ${
                    selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                  }`}
                  activeOpacity={0.8}
                >
                  <View className="flex-1">
                    <Text className={`font-bold text-sm ${selected ? 'text-sky-700' : 'text-slate-700'}`}>
                      {option.label}
                    </Text>
                    <Text className="text-xs text-slate-500 mt-0.5">{option.desc}</Text>
                  </View>
                  <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                    selected ? 'border-sky-500 bg-sky-500' : 'border-slate-300'
                  }`}>
                    {selected && <View className="w-2 h-2 rounded-full bg-white" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 일정 밀도 선택 */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-1">일정 밀도</Text>
          <Text className="text-xs text-slate-400 mb-4">하루에 몇 곳을 둘러볼지 선택하세요</Text>
          <View className="gap-3">
            {DENSITY_OPTIONS.map((option) => {
              const selected = selectedDensity === option.density;
              return (
                <TouchableOpacity
                  key={option.density}
                  onPress={() => setSelectedDensity(option.density)}
                  className={`flex-row items-center px-4 py-4 rounded-2xl border-2 ${
                    selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                  }`}
                  activeOpacity={0.8}
                >
                  <View className="flex-1">
                    <Text className={`font-bold text-sm ${selected ? 'text-sky-700' : 'text-slate-700'}`}>
                      {option.label}
                    </Text>
                    <Text className="text-xs text-slate-500 mt-0.5">{option.desc}</Text>
                  </View>
                  <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                    selected ? 'border-sky-500 bg-sky-500' : 'border-slate-300'
                  }`}>
                    {selected && <View className="w-2 h-2 rounded-full bg-white" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View className="h-4" />
      </ScrollView>

      {/* 다음 버튼 */}
      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={onNext}
          className="bg-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          <Text className="text-white font-bold text-base">다음 단계</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

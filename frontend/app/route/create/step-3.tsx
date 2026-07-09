import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Density } from '@/types';

const RATIO_OPTIONS = [
  { key: 'mainstream', ratio: 0.1 },
  { key: 'mixed', ratio: 0.5 },
  { key: 'hiddenGem', ratio: 0.9 },
] as const;

const DENSITY_OPTIONS = [
  { key: 'relaxed', density: 'relaxed' as const },
  { key: 'normal', density: 'normal' as const },
  { key: 'packed', density: 'packed' as const },
] as const;

export default function RouteCreateStep3() {
  const { t } = useTranslation();
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
  const [totalBudget, setTotalBudget] = useState('');

  const onNext = () => {
    router.push({
      pathname: '/route/create/step-4',
      params: {
        ...params,
        hiddenGemRatio: String(selectedRatio),
        density: selectedDensity,
        ...(totalBudget.trim() ? { totalBudget: totalBudget.trim() } : {}),
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
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 4 / 5</Text>
          <Text className="text-xl font-bold text-slate-800">{t('routeCreateStep3.headerTitle')}</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 요약 */}
        <View className="bg-sky-50 rounded-2xl px-4 py-3 mb-6 flex-row items-center gap-2">
          <Text className="text-sky-600 font-bold">{t(`routeCreateStep1.cities.${params.destination}`)}</Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">
            {t('routeCreateStep1.nightsBadge', { nights: params.nights, days: Number(params.nights) + 1 })}
          </Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">
            {t(`routeCreateStep2.budgetLevels.${params.budgetLevel ?? 'mid'}.label`)}
          </Text>
        </View>

        {/* 장소 성향 선택 */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-1">{t('routeCreateStep3.placeSentimentLabel')}</Text>
          <Text className="text-xs text-slate-400 mb-4">{t('routeCreateStep3.placeSentimentHint')}</Text>
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
                      {t(`routeCreateStep3.ratioOptions.${option.key}.label`)}
                    </Text>
                    <Text className="text-xs text-slate-500 mt-0.5">
                      {t(`routeCreateStep3.ratioOptions.${option.key}.desc`)}
                    </Text>
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
          <Text className="font-bold text-slate-700 mb-1">{t('routeCreateStep3.densityLabel')}</Text>
          <Text className="text-xs text-slate-400 mb-4">{t('routeCreateStep3.densityHint')}</Text>
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
                      {t(`routeCreateStep3.densityOptions.${option.key}.label`)}
                    </Text>
                    <Text className="text-xs text-slate-500 mt-0.5">
                      {t(`routeCreateStep3.densityOptions.${option.key}.desc`)}
                    </Text>
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

        {/* 총예산 입력 */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-1">{t('routeCreateStep3.budgetLabel')}</Text>
          <Text className="text-xs text-slate-400 mb-4">
            {t('routeCreateStep3.budgetHint')}
          </Text>
          <View className="flex-row items-center bg-slate-50 border-2 border-slate-200 rounded-2xl px-4">
            <TextInput
              value={totalBudget}
              onChangeText={(text) => setTotalBudget(text.replace(/[^0-9]/g, ''))}
              placeholder={t('routeCreateStep3.budgetPlaceholder')}
              keyboardType="number-pad"
              className="flex-1 py-3 px-2 text-sm text-slate-700"
            />
            <Text className="text-slate-400 text-sm">{t('routeCreateStep3.currencyWon')}</Text>
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
          <Text className="text-white font-bold text-base">{t('routeCreateStep3.nextButton')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

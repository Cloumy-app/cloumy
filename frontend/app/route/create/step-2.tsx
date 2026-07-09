import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BudgetLevel } from '@/types';

const THEMES = ['맛집', '카페', '관광', '자연', '쇼핑', '문화', '액티비티', '힐링', '야경'];

const BUDGET_LEVEL_VALUES: { value: BudgetLevel; perDayMin: number; perDayMax: number | null }[] = [
  { value: 'tight',   perDayMin: 10000,  perDayMax: 20000  },
  { value: 'budget',  perDayMin: 30000,  perDayMax: 40000  },
  { value: 'mid',     perDayMin: 50000,  perDayMax: 70000  },
  { value: 'premium', perDayMin: 80000,  perDayMax: 120000 },
  { value: 'luxury',  perDayMin: 130000, perDayMax: null   },
];

interface Step2Form {
  tags: string[];
  budgetLevel: BudgetLevel;
}

function buildStep2Schema(t: (key: string) => string) {
  return z.object({
    tags: z.array(z.string()).min(1, t('routeCreateStep2.tagsRequired')),
    budgetLevel: z.enum(['tight', 'budget', 'mid', 'premium', 'luxury']),
  });
}

export default function RouteCreateStep2() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
  }>();

  const nightsNum = Number(params.nights);
  const days = Number.isNaN(nightsNum) ? null : Math.max(nightsNum + 1, 1);

  const step2Schema = useMemo(() => buildStep2Schema(t), [t]);
  const { control, handleSubmit, formState: { errors } } = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { tags: [], budgetLevel: 'mid' },
  });

  const onNext = (data: Step2Form) => {
    router.push({
      pathname: '/route/create/step-3',
      params: {
        ...params,
        tags: JSON.stringify(data.tags),
        budgetLevel: data.budgetLevel,
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
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 3 / 5</Text>
          <Text className="text-xl font-bold text-slate-800">{t('routeCreateStep2.headerTitle')}</Text>
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
            {t(`routeCreateStep1.groupTypes.${params.groupType}`)}
          </Text>
        </View>

        {/* 테마 선택 */}
        <View className="mb-6">
          <Text className="font-bold text-slate-700 mb-3">{t('routeCreateStep2.themeLabel')}</Text>
          <Controller
            control={control}
            name="tags"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row flex-wrap gap-2">
                {THEMES.map((theme) => {
                  const selected = value.includes(theme);
                  return (
                    <TouchableOpacity
                      key={theme}
                      onPress={() => {
                        if (selected) onChange(value.filter((v) => v !== theme));
                        else onChange([...value, theme]);
                      }}
                      className={`px-4 py-2.5 rounded-2xl border-2 ${
                        selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text className={`font-semibold text-sm ${selected ? 'text-sky-600' : 'text-slate-600'}`}>
                        {t(`routeCreateStep2.themes.${theme}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          />
          {errors.tags && (
            <Text className="text-rose-500 text-xs mt-2">{errors.tags.message}</Text>
          )}
        </View>

        {/* 예산 수준 */}
        <View className="mb-8">
          <Text className="font-bold text-slate-700 mb-3">{t('routeCreateStep2.budgetLabel')}</Text>
          <Controller
            control={control}
            name="budgetLevel"
            render={({ field: { value, onChange } }) => (
              <View className="gap-2">
                {BUDGET_LEVEL_VALUES.map((b) => (
                  <TouchableOpacity
                    key={b.value}
                    onPress={() => onChange(b.value)}
                    className={`flex-row items-center px-4 py-3.5 rounded-2xl border-2 ${
                      value === b.value ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <View className="flex-1">
                      <Text className={`font-bold text-sm ${value === b.value ? 'text-sky-700' : 'text-slate-700'}`}>
                        {t(`routeCreateStep2.budgetLevels.${b.value}.label`)}
                      </Text>
                      <Text className="text-xs text-slate-500 mt-0.5">
                        {t(`routeCreateStep2.budgetLevels.${b.value}.desc`)}
                      </Text>
                      {days !== null && (
                        <Text className="text-xs text-slate-400 mt-0.5">
                          {b.perDayMax === null
                            ? t('routeCreateStep2.budgetEstimateMin', {
                                nights: nightsNum,
                                days,
                                min: Math.round((b.perDayMin * days) / 10000),
                              })
                            : t('routeCreateStep2.budgetEstimateRange', {
                                nights: nightsNum,
                                days,
                                min: Math.round((b.perDayMin * days) / 10000),
                                max: Math.round((b.perDayMax * days) / 10000),
                              })}
                          {' '}
                          <Text className="text-slate-300">{t('routeCreateStep2.excludesLodgingTransport')}</Text>
                        </Text>
                      )}
                    </View>
                    <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                      value === b.value ? 'border-sky-500 bg-sky-500' : 'border-slate-300'
                    }`}>
                      {value === b.value && <View className="w-2 h-2 rounded-full bg-white" />}
                    </View>
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
          <Text className="text-white font-bold text-base">{t('routeCreateStep2.nextButton')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

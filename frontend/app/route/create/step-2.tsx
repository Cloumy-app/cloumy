import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { BudgetLevel } from '@/types';

const THEMES = ['맛집', '카페', '관광', '자연', '쇼핑', '문화', '액티비티', '힐링', '야경'];

const BUDGET_LEVELS: { value: BudgetLevel; label: string; desc: string; perDayMin: number; perDayMax: number | null }[] = [
  { value: 'tight',   label: '초절약',   desc: '1인 하루 2만원 이하',  perDayMin: 10000,  perDayMax: 20000  },
  { value: 'budget',  label: '알뜰',     desc: '1인 하루 3~4만원',    perDayMin: 30000,  perDayMax: 40000  },
  { value: 'mid',     label: '여유롭게',  desc: '1인 하루 5~7만원',    perDayMin: 50000,  perDayMax: 70000  },
  { value: 'premium', label: '풍족하게',  desc: '1인 하루 8~12만원',   perDayMin: 80000,  perDayMax: 120000 },
  { value: 'luxury',  label: '특별하게',  desc: '1인 하루 13만원 이상', perDayMin: 130000, perDayMax: null   },
];

const step2Schema = z.object({
  tags: z.array(z.string()).min(1, '테마를 1개 이상 선택해주세요'),
  budgetLevel: z.enum(['budget', 'mid', 'premium']),
});

type Step2Form = z.infer<typeof step2Schema>;

export default function RouteCreateStep2() {
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
  }>();

  const nightsNum = Number(params.nights);
  const days = Number.isNaN(nightsNum) ? null : Math.max(nightsNum + 1, 1);

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
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 2 / 3</Text>
          <Text className="text-xl font-bold text-slate-800">어떤 여행을 원하세요?</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 요약 */}
        <View className="bg-sky-50 rounded-2xl px-4 py-3 mb-6 flex-row items-center gap-2">
          <Text className="text-sky-600 font-bold">{params.destination}</Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">{params.nights}박{Number(params.nights)+1}일</Text>
          <Text className="text-sky-400">·</Text>
          <Text className="text-sky-600 font-medium">
            {params.groupType === 'friends' ? '친구들' : params.groupType === 'couple' ? '커플' : params.groupType === 'family' ? '가족' : '혼자'}
          </Text>
        </View>

        {/* 테마 선택 */}
        <View className="mb-6">
          <Text className="font-bold text-slate-700 mb-3">여행 테마</Text>
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
                        if (selected) onChange(value.filter((t) => t !== theme));
                        else onChange([...value, theme]);
                      }}
                      className={`px-4 py-2.5 rounded-2xl border-2 ${
                        selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text className={`font-semibold text-sm ${selected ? 'text-sky-600' : 'text-slate-600'}`}>
                        {theme}
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
          <Text className="font-bold text-slate-700 mb-3">예산 수준</Text>
          <Controller
            control={control}
            name="budgetLevel"
            render={({ field: { value, onChange } }) => (
              <View className="gap-2">
                {BUDGET_LEVELS.map((b) => (
                  <TouchableOpacity
                    key={b.value}
                    onPress={() => onChange(b.value)}
                    className={`flex-row items-center px-4 py-3.5 rounded-2xl border-2 ${
                      value === b.value ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <View className="flex-1">
                      <Text className={`font-bold text-sm ${value === b.value ? 'text-sky-700' : 'text-slate-700'}`}>
                        {b.label}
                      </Text>
                      <Text className="text-xs text-slate-500 mt-0.5">{b.desc}</Text>
                      {days !== null && (
                        <Text className="text-xs text-slate-400 mt-0.5">
                          {nightsNum}박{days}일 약{' '}
                          {b.perDayMax === null
                            ? `${Math.round(b.perDayMin * days / 10000)}만원 이상`
                            : `${Math.round(b.perDayMin * days / 10000)}~${Math.round(b.perDayMax * days / 10000)}만원`}
                          {' '}
                          <Text className="text-slate-300">(숙박·교통 제외)</Text>
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
          <Text className="text-white font-bold text-base">다음 단계</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

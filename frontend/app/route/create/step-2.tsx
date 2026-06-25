import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { useState, useRef } from 'react';
import { streamRoute } from '@/lib/api/routes';
import { useRouteStore } from '@/stores/useRouteStore';
import type { RouteSlot } from '@/types';

const THEMES = ['맛집', '카페', '관광', '자연', '쇼핑', '문화', '액티비티', '힐링', '야경'];
const BUDGET_LEVELS = [
  { value: 'budget', label: '알뜰', desc: '1만원대' },
  { value: 'mid', label: '보통', desc: '3만원대' },
  { value: 'premium', label: '프리미엄', desc: '5만원 이상' },
] as const;

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

  const { control, handleSubmit, formState: { errors } } = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { tags: [], budgetLevel: 'mid' },
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const stopStreamRef = useRef<(() => void) | null>(null);
  const { appendStreamingSlot, finalizeRoute, setIsStreaming } = useRouteStore();

  const onGenerate = (data: Step2Form) => {
    const nights = Number(params.nights ?? 2);
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const endDate = new Date(today.getTime() + nights * 86400000).toISOString().split('T')[0];

    setIsGenerating(true);
    setIsStreaming(true);

    let routeId = '';

    stopStreamRef.current = streamRoute(
      {
        destination: params.destination ?? '서울',
        startDate,
        endDate,
        groupType: (params.groupType ?? 'friends') as 'friends',
        budgetLevel: data.budgetLevel,
        tags: data.tags,
      },
      (slot: RouteSlot) => {
        appendStreamingSlot(slot);
      },
      (id: string) => {
        routeId = id;
        // 루트 ID 수신 즉시 결과 화면으로 이동
        router.replace({
          pathname: '/route/[routeId]',
          params: { routeId: id },
        });
      },
      () => {
        finalizeRoute(routeId, params.destination ?? '서울', startDate, endDate);
        setIsGenerating(false);
      },
      () => {
        setIsGenerating(false);
        setIsStreaming(false);
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* 헤더 */}
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 2 / 2</Text>
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

      {/* 생성 버튼 */}
      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={handleSubmit(onGenerate)}
          disabled={isGenerating}
          className={`py-4 rounded-2xl items-center flex-row justify-center gap-2 ${
            isGenerating ? 'bg-sky-300' : 'bg-sky-500'
          }`}
          activeOpacity={0.9}
        >
          {isGenerating ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Sparkles size={20} color="#ffffff" />
          )}
          <Text className="text-white font-bold text-base">
            {isGenerating ? 'AI가 루트를 생성 중...' : 'AI 루트 생성하기'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

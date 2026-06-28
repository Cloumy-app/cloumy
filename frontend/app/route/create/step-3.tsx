import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { useState, useRef, useEffect } from 'react';
import { streamRoute } from '@/lib/api/routes';
import { useRouteStore } from '@/stores/useRouteStore';
import type { GroupType, BudgetLevel, RouteSlot } from '@/types';
import { BUDGET_LABEL } from '@/types';

const RATIO_OPTIONS = [
  { label: '관광지 위주', desc: '유명 명소 중심으로 알차게', ratio: 0.1 },
  { label: '혼합',       desc: '관광지와 숨은 명소 균형 있게', ratio: 0.5 },
  { label: '숨은 명소 위주', desc: '현지인만 아는 특별한 장소', ratio: 0.9 },
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
  const [isGenerating, setIsGenerating] = useState(false);
  const stopStreamRef = useRef<(() => void) | null>(null);
  const hasNavigatedRef = useRef(false);
  const { appendStreamingSlot, finalizeRoute, setIsStreaming, reset } = useRouteStore();

  useEffect(() => {
    return () => {
      stopStreamRef.current?.();
      setIsStreaming(false);
    };
  }, []);

  const onGenerate = () => {
    const nights = Number(params.nights ?? 2);
    const startDate = params.startDate ?? new Date().toISOString().split('T')[0];
    const endDate = params.endDate ?? new Date(Date.now() + nights * 86400000).toISOString().split('T')[0];
    let tags: string[] = [];
    try {
      tags = params.tags ? (JSON.parse(params.tags) as string[]) : [];
    } catch {
      tags = [];
    }

    reset();
    hasNavigatedRef.current = false;
    setIsGenerating(true);
    setIsStreaming(true);

    let routeId = '';

    stopStreamRef.current = streamRoute(
      {
        destination: params.destination ?? '서울',
        startDate,
        endDate,
        groupType: (params.groupType ?? 'friends') as GroupType,
        budgetLevel: (params.budgetLevel ?? 'mid') as BudgetLevel,
        tags,
        hiddenGemRatio: selectedRatio,
      },
      (slot: RouteSlot) => {
        appendStreamingSlot(slot);
      },
      (id: string) => {
        if (hasNavigatedRef.current) return;
        hasNavigatedRef.current = true;
        routeId = id;
        router.replace({
          pathname: '/route/[routeId]',
          params: { routeId: id, budgetLevel: params.budgetLevel ?? 'mid' },
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
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 3 / 3</Text>
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

        <View className="h-4" />
      </ScrollView>

      {/* 루트 생성 버튼 */}
      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={onGenerate}
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

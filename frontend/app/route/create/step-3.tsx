import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { useState, useRef, useEffect } from 'react';
import { streamRoute } from '@/lib/api/routes';
import { devLogin } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/useAuthStore';
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

  const destination = params.destination ?? '여행지';

  const LOADING_MESSAGES = [
    `${destination}의 숨은 명소를 찾고 있어요`,
    '최적의 이동 동선을 계산하고 있어요',
    '맛집과 관광지를 균형 있게 배치해요',
    '이동 시간을 최소화하고 있어요',
    '완벽한 여행 루트가 거의 완성됐어요!',
  ];

  const [selectedRatio, setSelectedRatio] = useState(0.5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [slotCount, setSlotCount] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const stopStreamRef = useRef<(() => void) | null>(null);
  const routeIdRef = useRef<string>('');
  const { appendStreamingSlot, finalizeRoute, setIsStreaming, reset } = useRouteStore();
  const { setTokens, setUser } = useAuthStore();

  // 생성 중 메시지 순환
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // 슬롯 수에 따른 프로그레스 계산
  useEffect(() => {
    if (!isGenerating) return;
    const nights = Number(params.nights ?? 2);
    const estimated = nights * 4;
    setProgress(Math.min(95, Math.round((slotCount / estimated) * 100)));
  }, [slotCount, isGenerating]);

  useEffect(() => {
    return () => {
      // 뒤로가기 등으로 언마운트 시 스트림 정리
      if (!routeIdRef.current) {
        stopStreamRef.current?.();
        setIsStreaming(false);
      }
    };
  }, []);

  const onGenerate = async () => {
    if (__DEV__) {
      try {
        const data = await devLogin();
        setTokens(data.accessToken, data.refreshToken);
        setUser(data.user);
      } catch {
        Alert.alert('서버 연결 실패', 'Spring 서버가 실행 중인지 확인해주세요.');
        return;
      }
    }

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
    routeIdRef.current = '';
    setSlotCount(0);
    setProgress(0);
    setMessageIndex(0);
    setIsGenerating(true);
    setIsStreaming(true);

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
        setSlotCount((c) => c + 1);
      },
      (id: string) => {
        routeIdRef.current = id;
      },
      () => {
        const id = routeIdRef.current;
        finalizeRoute(id, params.destination ?? '서울', startDate, endDate);
        setProgress(100);
        setTimeout(() => {
          setIsGenerating(false);
          router.replace({
            pathname: '/route/[routeId]',
            params: { routeId: id, budgetLevel: params.budgetLevel ?? 'mid', mode: 'new' },
          });
        }, 500);
      },
      (e) => {
        setIsGenerating(false);
        setIsStreaming(false);
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        Alert.alert('루트 생성 실패', `오류가 발생했어요.\n${msg}`);
      },
    );
  };

  // 로딩 화면
  if (isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <View className="w-24 h-24 bg-sky-50 rounded-full items-center justify-center mb-8">
          <Sparkles size={40} color="#0ea5e9" />
        </View>

        <Text className="text-2xl font-black text-slate-800 mb-2 text-center">루트 생성 중</Text>
        <Text className="text-slate-500 text-center mb-10 text-sm px-4">
          {LOADING_MESSAGES[messageIndex]}
        </Text>

        {/* 프로그레스 바 */}
        <View className="w-full bg-slate-100 rounded-full h-2 mb-3">
          <View
            className="bg-sky-500 h-2 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </View>
        <Text className="text-sky-500 font-bold text-lg">{progress}%</Text>
      </SafeAreaView>
    );
  }

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
          className="bg-sky-500 py-4 rounded-2xl items-center flex-row justify-center gap-2"
          activeOpacity={0.9}
        >
          <Sparkles size={20} color="#ffffff" />
          <Text className="text-white font-bold text-base">AI 루트 생성하기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

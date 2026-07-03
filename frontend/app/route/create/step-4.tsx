import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Sparkles, Search, MapPin, X } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { streamRoute } from '@/lib/api/routes';
import { searchAccommodations, type KakaoPlaceResult } from '@/lib/api/accommodations';
import { devLogin } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/useAuthStore';
import { useRouteStore } from '@/stores/useRouteStore';
import { useAccommodationPinStore } from '@/stores/useAccommodationPinStore';
import type { GroupType, BudgetLevel, Density, RouteSlot, AccommodationInput } from '@/types';
import { BUDGET_LABEL } from '@/types';

type SelectedAccommodation = { name: string; address: string | null; lat: number; lng: number; source: 'kakao' | 'manual' };

const DENSITY_SLOTS_PER_DAY: Record<Density, number> = { relaxed: 3, normal: 4.5, packed: 6 };

function getLoadingMessage(progress: number, ratio: number, destination: string): string {
  if (progress < 20) return `${destination} 후보 장소를 살펴보고 있어요`;
  if (progress < 50) {
    if (ratio >= 0.6) return `${destination}의 숨은 명소를 찾고 있어요`;
    if (ratio <= 0.3) return `${destination}의 인기 명소를 찾고 있어요`;
    return '명소와 로컬 스팟을 균형 있게 담고 있어요';
  }
  if (progress < 80) return '최적의 이동 동선을 계산하고 있어요';
  if (progress < 95) return '예산과 일정을 다듬고 있어요';
  return '완벽한 여행 루트가 거의 완성됐어요!';
}

export default function RouteCreateStep4() {
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
    tags: string;
    budgetLevel: string;
    hiddenGemRatio: string;
    density: string;
  }>();

  const destination = params.destination ?? '여행지';
  const selectedRatio = Number(params.hiddenGemRatio ?? 0.5);
  const selectedDensity = (params.density ?? 'normal') as Density;

  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<KakaoPlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SelectedAccommodation | null>(null);
  const [manualName, setManualName] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [slotCount, setSlotCount] = useState(0);
  const [progress, setProgress] = useState(0);

  const stopStreamRef = useRef<(() => void) | null>(null);
  const routeIdRef = useRef<string>('');
  const isMountedRef = useRef(true);
  const { appendStreamingSlot, setDaySummary, finalizeRoute, setIsStreaming, reset } = useRouteStore();
  const { setTokens, setUser } = useAuthStore();
  const pin = useAccommodationPinStore((s) => s.pin);
  const clearPin = useAccommodationPinStore((s) => s.clearPin);
  const queryClient = useQueryClient();

  // 지도 핀 선택 화면에서 돌아오면 선택 상태로 반영 (좌표만 있고 이름은 사용자가 직접 입력)
  useEffect(() => {
    if (!pin) return;
    setSelected({ name: '', address: pin.address, lat: pin.lat, lng: pin.lng, source: 'manual' });
    setManualName('');
    clearPin();
  }, [pin]);

  // 검색어 디바운스(400ms) — 매 키 입력마다 API 호출 방지
  useEffect(() => {
    if (!keyword.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchAccommodations(keyword.trim());
      setResults(found);
      setSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    if (!isGenerating) return;
    const nights = Number(params.nights ?? 2);
    const days = nights + 1;
    const estimated = Math.max(1, Math.round(days * DENSITY_SLOTS_PER_DAY[selectedDensity]));
    setProgress(Math.min(95, Math.round((slotCount / estimated) * 100)));
  }, [slotCount, isGenerating, selectedDensity]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (!routeIdRef.current) {
        stopStreamRef.current?.();
        setIsStreaming(false);
      }
    };
  }, []);

  const onPickResult = (result: KakaoPlaceResult) => {
    setSelected({ ...result, source: 'kakao' });
    setKeyword('');
    setResults([]);
  };

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

    // 숙소는 여행당 1건 — 연박 전체를 여행 시작~종료일 하나로(다중 숙소는 범위 밖)
    let accommodations: AccommodationInput[] | undefined;
    if (selected) {
      const name = selected.source === 'manual' ? manualName.trim() : selected.name;
      if (!name) {
        Alert.alert('숙소 이름을 입력해주세요', '지도에서 선택한 위치는 이름을 직접 입력해야 해요.');
        return;
      }
      accommodations = [{
        name, address: selected.address, lat: selected.lat, lng: selected.lng,
        checkInDate: startDate, checkOutDate: endDate, source: selected.source,
      }];
    }

    reset();
    routeIdRef.current = '';
    setSlotCount(0);
    setProgress(0);
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
        density: selectedDensity,
        accommodations,
      },
      (slot: RouteSlot) => {
        if (!isMountedRef.current) return;
        appendStreamingSlot(slot);
        setSlotCount((c) => c + 1);
      },
      (day: number, summary: string) => {
        if (!isMountedRef.current) return;
        setDaySummary(day, summary);
      },
      (id: string) => {
        routeIdRef.current = id;
      },
      () => {
        if (!isMountedRef.current) return;
        const id = routeIdRef.current;
        finalizeRoute(id, params.destination ?? '서울', startDate, endDate);
        queryClient.invalidateQueries({ queryKey: ['routes'] });
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
        if (!isMountedRef.current) return;
        setIsGenerating(false);
        setIsStreaming(false);
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        Alert.alert('루트 생성 실패', `오류가 발생했어요.\n${msg}`);
      },
    );
  };

  if (isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <View className="w-24 h-24 bg-sky-50 rounded-full items-center justify-center mb-8">
          <Sparkles size={40} color="#0ea5e9" />
        </View>
        <Text className="text-2xl font-black text-slate-800 mb-2 text-center">루트 생성 중</Text>
        <Text className="text-slate-500 text-center mb-10 text-sm px-4">
          {getLoadingMessage(progress, selectedRatio, destination)}
        </Text>
        <View className="w-full bg-slate-100 rounded-full h-2 mb-3">
          <View className="bg-sky-500 h-2 rounded-full" style={{ width: `${progress}%` }} />
        </View>
        <Text className="text-sky-500 font-bold text-lg">{progress}%</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 4 / 4</Text>
          <Text className="text-xl font-bold text-slate-800">숙소가 있으신가요?</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text className="text-xs text-slate-400 mb-4">
          숙소를 알려주시면 그날 동선을 숙소 기준으로 짜드려요 (선택 사항)
        </Text>

        {selected ? (
          <View className="border-2 border-sky-500 bg-sky-50 rounded-2xl px-4 py-4 mb-4">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 mr-2">
                {selected.source === 'manual' ? (
                  <TextInput
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="숙소 이름을 입력해주세요"
                    className="font-bold text-sky-700 text-sm mb-1"
                  />
                ) : (
                  <Text className="font-bold text-sky-700 text-sm mb-1">{selected.name}</Text>
                )}
                {selected.address && (
                  <Text className="text-xs text-sky-500" numberOfLines={2}>{selected.address}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => { setSelected(null); setManualName(''); }}>
                <X size={18} color="#0284c7" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View className="flex-row items-center bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 mb-3">
              <Search size={18} color="#94a3b8" />
              <TextInput
                value={keyword}
                onChangeText={setKeyword}
                placeholder="숙소 이름으로 검색"
                className="flex-1 py-3 px-2 text-sm text-slate-700"
              />
              {searching && <ActivityIndicator size="small" />}
            </View>

            {keyword.trim().length > 0 && !searching && results.length === 0 && (
              <Text className="text-xs text-slate-400 mb-3">
                검색 결과가 없어요 — 지도에서 직접 선택해보세요
              </Text>
            )}

            {results.length > 0 && (
              <View className="mb-3 border border-slate-100 rounded-2xl overflow-hidden">
                <FlatList
                  data={results}
                  keyExtractor={(item, i) => `${item.name}-${i}`}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      onPress={() => onPickResult(item)}
                      className="px-4 py-3 border-b border-slate-100 bg-white"
                    >
                      <Text className="font-semibold text-sm text-slate-700">{item.name}</Text>
                      {item.address && (
                        <Text className="text-xs text-slate-400 mt-0.5" numberOfLines={1}>{item.address}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <TouchableOpacity
              onPress={() => router.push({ pathname: '/route/create/accommodation-pin', params: { destination } })}
              className="flex-row items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-2xl py-3 mb-6"
              activeOpacity={0.8}
            >
              <MapPin size={16} color="#0ea5e9" />
              <Text className="text-sky-600 font-semibold text-sm">지도에서 직접 선택</Text>
            </TouchableOpacity>
          </>
        )}

        <View className="h-4" />
      </ScrollView>

      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={onGenerate}
          className="bg-sky-500 py-4 rounded-2xl items-center flex-row justify-center gap-2"
          activeOpacity={0.9}
        >
          <Sparkles size={20} color="#ffffff" />
          <Text className="text-white font-bold text-base">
            {selected ? 'AI 루트 생성하기' : '건너뛰고 루트 생성하기'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

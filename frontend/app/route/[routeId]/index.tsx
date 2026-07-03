import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { ChevronLeft, Sparkles, Wallet } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { getRoute, getRouteSlots, getRouteDaySummaries, toggleSlotPin as apiToggleSlotPin, deleteRouteSlot, deleteRoute } from '@/lib/api/routes';
import { fetchForecast } from '@/lib/api/weather';
import { useRouteStore } from '@/stores/useRouteStore';
import { TripMap } from '@/components/map/TripMap';
import { DayTabs } from '@/components/route/DayTabs';
import { SlotCard } from '@/components/route/SlotCard';
import type { BudgetLevel, RouteDaySummary, SlotAlternative, SlotWithCoords } from '@/types';
import type { DayWeather, RainBlock } from '@/lib/api/weather';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function getDateForDay(startDate: string, dayNumber: number): string {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayNumber - 1);
  return date.toISOString().split('T')[0];
}

// index는 하루 안에서의 렌더링 순서(0-indexed) — AI 시스템 프롬프트(route_service.py)의
// "앞쪽(1~2)=오전, 중간(3)=오후, 뒤쪽(4~5)=저녁" 근사치와 반드시 동일하게 맞춘다.
function isSlotInRainyBlock(dayWeather: DayWeather | null | undefined, index: number): boolean {
  if (!dayWeather?.rainyBlocks.length) return false;
  const block: RainBlock = index < 2 ? '오전' : index === 2 ? '오후' : '저녁';
  return dayWeather.rainyBlocks.includes(block);
}

export default function RouteResultScreen() {
  const { routeId, budgetLevel, mode } = useLocalSearchParams<{
    routeId: string;
    budgetLevel?: string;
    mode?: string;
  }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const slotPositions = useRef<Record<string, number>>({});
  const exitConfirmedRef = useRef(false);

  const isNewRoute = mode === 'new';

  // 스냅 포인트
  const SNAP_TOP = insets.top + 60;
  const SNAP_MIDDLE = SCREEN_HEIGHT * 0.48;
  const SNAP_BOTTOM = SCREEN_HEIGHT * 0.72;
  const SHEET_HEIGHT = SCREEN_HEIGHT - SNAP_TOP + 20;

  const sheetY = useSharedValue(SNAP_BOTTOM);
  const startY = useSharedValue(SNAP_BOTTOM);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = sheetY.value;
    })
    .onUpdate((e) => {
      sheetY.value = Math.max(SNAP_TOP, Math.min(SNAP_BOTTOM, startY.value + e.translationY));
    })
    .onEnd((e) => {
      const dest =
        e.velocityY < -500 || sheetY.value < SNAP_MIDDLE
          ? SNAP_TOP
          : e.velocityY > 500 || sheetY.value > SNAP_MIDDLE
          ? SNAP_BOTTOM
          : SNAP_MIDDLE;
      sheetY.value = withTiming(dest, { duration: 280, easing: Easing.out(Easing.cubic) });
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const {
    currentRoute,
    streamingSlots,
    daySummaries: streamingDaySummaries,
    isStreaming,
    selectedDay,
    setSelectedDay,
    setCurrentRoute,
    toggleSlotPin,
    removeSlot,
  } = useRouteStore();

  // 홈 목록에서 기존 루트를 다시 열면(신규 생성 플로우를 안 거치면) currentRoute가
  // 비어 있어 destination/startDate가 빈 문자열이 되고 날씨 등이 영구 비활성화된다 —
  // 그 경우에만 메타데이터를 별도로 조회해 currentRoute를 채운다.
  const { data: routeMeta } = useQuery({
    queryKey: ['route', routeId],
    queryFn: () => getRoute(routeId!),
    enabled: !!routeId && !isStreaming && currentRoute?.id !== routeId,
  });

  useEffect(() => {
    if (routeMeta && currentRoute?.id !== routeId) {
      setCurrentRoute({
        id: routeMeta.id,
        destination: routeMeta.destination,
        startDate: routeMeta.startDate,
        endDate: routeMeta.endDate,
        slots: [],
        createdAt: routeMeta.createdAt,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMeta]);

  const destination = currentRoute?.destination ?? '';
  const routeStartDate = currentRoute?.startDate ?? '';

  const { data: apiSlots, isLoading: slotsLoading } = useQuery({
    queryKey: ['route-slots', routeId],
    queryFn: () => getRouteSlots(routeId!),
    enabled: !!routeId && !isStreaming,
    staleTime: 1000 * 60 * 5,
  });

  const hasApiSlots = !!(apiSlots && apiSlots.length > 0);

  // 날씨 예보: 여행 날짜 배열 생성 후 fetch
  const days = hasApiSlots
    ? [...new Set(apiSlots!.map((s) => s.dayNumber))].sort()
    : [...new Set(streamingSlots.map((s) => s.day))].sort();

  const travelDates = routeStartDate
    ? days.map((day) => getDateForDay(routeStartDate, day))
    : [];

  const { data: weatherByDate } = useQuery<Record<string, DayWeather>>({
    queryKey: ['forecast', destination, travelDates.join(',')],
    queryFn: () => fetchForecast(destination, travelDates),
    enabled: !!destination && travelDates.length > 0 && !isStreaming,
    staleTime: 1000 * 60 * 60,
  });

  const { data: daySummaries } = useQuery<RouteDaySummary[]>({
    queryKey: ['day-summaries', routeId],
    queryFn: () => getRouteDaySummaries(routeId!),
    enabled: !!routeId && !isStreaming,
    staleTime: 1000 * 60 * 5,
  });

  const currentDaySummary = hasApiSlots
    ? daySummaries?.find((d) => d.dayNumber === selectedDay)?.summary
    : streamingDaySummaries[selectedDay];

  const currentDateStr = routeStartDate ? getDateForDay(routeStartDate, selectedDay) : null;
  const currentDayWeather = currentDateStr ? weatherByDate?.[currentDateStr] : undefined;

  const streamSlots =
    isStreaming || currentRoute?.id === routeId
      ? (currentRoute?.slots ?? streamingSlots)
      : streamingSlots;

  const currentDayApiSlots: SlotWithCoords[] = hasApiSlots
    ? apiSlots!.filter((s) => s.dayNumber === selectedDay)
    : [];

  const currentDayStreamSlots = streamSlots.filter((s) => s.day === selectedDay);

  const dayBudget = currentDayApiSlots.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

  useEffect(() => {
    if (hasApiSlots) {
      sheetY.value = withTiming(SNAP_MIDDLE, { duration: 280, easing: Easing.out(Easing.cubic) });
    }
  }, [hasApiSlots]);

  const handleMapSlotPress = (slotId: string) => {
    setFocusedSlotId(slotId);
    sheetY.value = withTiming(SNAP_MIDDLE, { duration: 280, easing: Easing.out(Easing.cubic) });
    // 바텀시트 스냅 애니메이션 후 슬롯으로 스크롤
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: slotPositions.current[slotId] ?? 0, animated: true });
    }, 420);
  };

  const handleReplaceWithAlternative = (slotId: string, alt: SlotAlternative) => {
    queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
      prev?.map((s) =>
        s.id === slotId
          ? { ...s, placeName: alt.placeName, lat: alt.lat, lng: alt.lng, estimatedCost: alt.estimatedCost, tips: alt.reason }
          : s,
      ),
    );
  };

  const handlePin = async (slotId: string) => {
    if (!routeId) return;
    try {
      const updated = await apiToggleSlotPin(routeId, slotId);
      queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
        prev?.map((s) => (s.id === slotId ? { ...s, pinned: updated.pinned } : s)),
      );
    } catch {}
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (!routeId) return;
    // 낙관적 필터링: 즉시 목록에서 제거
    queryClient.setQueryData<SlotWithCoords[]>(['route-slots', routeId], (prev) =>
      prev?.filter((s) => s.id !== slotId),
    );
    try {
      await deleteRouteSlot(routeId, slotId);
      // 서버가 재정렬한 orderIndex 반영
      queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
    } catch {
      // 실패 시 원본 복구
      queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
    }
  };

  // 신규 생성 직후 "저장하기"를 안 누르고 나가면(헤더 버튼/스와이프 제스처/하드웨어 백/
  // 하단 "나가기" 버튼 전부 포함) 삭제 확인창을 띄우고 실제로 라우트를 지운다.
  // beforeRemove로 모든 이탈 경로를 한 곳에서 가로채야, 뒤로가기 아이콘이 router.back()을
  // 직접 호출해 확인창을 우회하던 문제가 재발하지 않는다.
  useEffect(() => {
    if (!isNewRoute) return;
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (exitConfirmedRef.current) return;
      e.preventDefault();
      Alert.alert('루트 삭제', '나가면 생성된 루트가 삭제됩니다. 계속하시겠습니까?', [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제 후 나가기',
          style: 'destructive',
          onPress: async () => {
            try {
              if (routeId) await deleteRoute(routeId);
            } catch {}
            // 삭제 성공 후에도 홈의 "다가오는 여행" 캐시가 무효화되지 않으면 방금
            // 지운 루트가 계속 남아있는 것처럼 보인다 — 반드시 여기서 무효화한다.
            queryClient.invalidateQueries({ queryKey: ['routes'] });
            exitConfirmedRef.current = true;
            // navigation.dispatch(e.data.action)로 원래 백 액션을 재개하면 step-3가
            // router.replace()로 사라진 자리 아래 남아있는 step-2로 가버린다 —
            // "첫 화면"(홈)으로 보내려면 명시적으로 이동해야 한다.
            router.replace('/(tabs)');
          },
        },
      ]);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isNewRoute, routeId]);

  const handleEditCancel = () => {
    // 서버 원본으로 복구
    queryClient.invalidateQueries({ queryKey: ['route-slots', routeId] });
    setIsEditMode(false);
    setFocusedSlotId(null);
  };

  const displaySlots: SlotWithCoords[] = hasApiSlots ? apiSlots! : [];
  const showEditControls = isNewRoute || isEditMode;

  return (
    <View style={{ flex: 1 }}>
      {/* 지도 (전체 화면 배경) */}
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          slots={displaySlots}
          selectedDay={selectedDay}
          height={SCREEN_HEIGHT}
          focusedSlotId={focusedSlotId ?? undefined}
          onSlotPress={handleMapSlotPress}
        />
      </View>

      {/* 플로팅 헤더 */}
      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            bottom: undefined,
            zIndex: 30,
            paddingTop: insets.top + 8,
            paddingHorizontal: 24,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: insets.top + 72,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <ChevronLeft size={24} color="#334155" />
        </TouchableOpacity>

        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.92)',
            paddingHorizontal: 20,
            paddingVertical: 8,
            borderRadius: 20,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontWeight: '800', color: '#1e293b', fontSize: 15 }}>
              {destination || '루트 생성 완료'}
            </Text>
            {isStreaming && <Sparkles size={13} color="#0ea5e9" />}
          </View>
          {currentRoute && (
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748b' }}>
              {currentRoute.startDate} ~ {currentRoute.endDate}
            </Text>
          )}
        </View>

        <View style={{ width: 40 }} />
      </View>

      {/* Reanimated 드래그 바텀시트 */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: SHEET_HEIGHT,
            backgroundColor: 'white',
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 20,
            elevation: 10,
          },
          sheetStyle,
        ]}
      >
        {/* 드래그 핸들 + 시트 헤더 */}
        <GestureDetector gesture={panGesture}>
          <View>
            <View
              style={{
                width: 48,
                height: 6,
                backgroundColor: '#e2e8f0',
                borderRadius: 3,
                alignSelf: 'center',
                marginTop: 12,
                marginBottom: 8,
              }}
            />

            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#f1f5f9',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#1e293b' }}>
                  {selectedDay}일차 타임라인
                </Text>
                {dayBudget > 0 && (
                  <View
                    style={{
                      backgroundColor: '#f0f9ff',
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 20,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Wallet size={11} color="#0ea5e9" />
                    <Text style={{ color: '#0ea5e9', fontSize: 10, fontWeight: '700' }}>
                      {dayBudget >= 10000
                        ? `약 ${Math.round(dayBudget / 10000)}만원`
                        : `${dayBudget.toLocaleString()}원`}
                    </Text>
                  </View>
                )}
                {isStreaming && <ActivityIndicator size="small" color="#0ea5e9" />}
              </View>
              <Text
                style={{ fontSize: 11, color: '#94a3b8', fontWeight: '500', marginTop: 2 }}
                numberOfLines={1}
              >
                {currentDaySummary ?? '위로 당기면 상세 일정이 펼쳐져요'}
              </Text>
            </View>

            {/* Day 탭 */}
            {days.length > 1 && hasApiSlots && (
              <DayTabs
                slots={apiSlots ?? []}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                weatherByDate={weatherByDate}
                startDate={routeStartDate}
                variant="planner"
              />
            )}
            {days.length > 1 && !hasApiSlots && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ paddingHorizontal: 24, paddingTop: 12 }}
                contentContainerStyle={{ gap: 8 }}
              >
                {days.map((day) => (
                  <TouchableOpacity
                    key={day}
                    onPress={() => setSelectedDay(day)}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderRadius: 20,
                      borderWidth: 1,
                      backgroundColor: selectedDay === day ? '#0ea5e9' : '#ffffff',
                      borderColor: selectedDay === day ? '#0ea5e9' : '#e2e8f0',
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        fontSize: 14,
                        color: selectedDay === day ? '#fff' : '#475569',
                      }}
                    >
                      {day}일차
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </GestureDetector>

        {/* 슬롯 목록 */}
        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: hasApiSlots ? 120 : 40,
            gap: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {hasApiSlots
            ? currentDayApiSlots.map((apiSlot, i) => (
                <View
                  key={apiSlot.id}
                  onLayout={(e) => {
                    slotPositions.current[apiSlot.id] = e.nativeEvent.layout.y;
                  }}
                >
                  <SlotCard
                    slot={null}
                    apiSlot={apiSlot}
                    index={i}
                    isLast={i === currentDayApiSlots.length - 1}
                    routeId={routeId}
                    budgetLevel={(budgetLevel ?? 'mid') as BudgetLevel}
                    viewMode="edit"
                    showActions={showEditControls}
                    isFocused={apiSlot.id === focusedSlotId}
                    isRainy={isSlotInRainyBlock(currentDayWeather, i)}
                    onPin={() => handlePin(apiSlot.id)}
                    onRemove={() => handleDeleteSlot(apiSlot.id)}
                    onReplaceWithAlternative={(alt) => handleReplaceWithAlternative(apiSlot.id, alt)}
                    onTap={() => {
                      setFocusedSlotId(apiSlot.id);
                      sheetY.value = withTiming(SNAP_MIDDLE, { duration: 280, easing: Easing.out(Easing.cubic) });
                    }}
                  />
                </View>
              ))
            : currentDayStreamSlots.map((slot, i) => (
                <SlotCard
                  key={`${slot.day}-${slot.order}-${i}`}
                  slot={slot}
                  index={i}
                  isLast={i === currentDayStreamSlots.length - 1}
                  viewMode="edit"
                  showActions={showEditControls}
                  isRainy={isSlotInRainyBlock(currentDayWeather, i)}
                  onPin={() => toggleSlotPin(slot.day, slot.order)}
                  onRemove={() => removeSlot(slot.day, slot.order)}
                />
              ))}

          {isStreaming && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <ActivityIndicator color="#0ea5e9" />
              <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>장소를 찾는 중...</Text>
            </View>
          )}

          {slotsLoading && !isStreaming && (
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <ActivityIndicator color="#0ea5e9" />
            </View>
          )}
        </ScrollView>

        {/* 하단 액션 버튼 */}
        {hasApiSlots && (
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              flexDirection: 'row',
              gap: 10,
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 14,
              backgroundColor: 'rgba(255,255,255,0.96)',
              borderTopWidth: 1,
              borderTopColor: '#f1f5f9',
            }}
          >
            {/* 신규 생성 루트: 저장하기 + 나가기 */}
            {isNewRoute && (
              <>
                <TouchableOpacity
                  onPress={() => {
                    // 명시적으로 저장을 선택했으니 이탈 시 삭제 확인창이 뜨면 안 됨
                    exitConfirmedRef.current = true;
                    queryClient.invalidateQueries({ queryKey: ['routes'] });
                    router.replace('/routes' as never);
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: '#0ea5e9',
                    paddingVertical: 10,
                    borderRadius: 14,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>저장하기</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{
                    flex: 1,
                    borderWidth: 2,
                    borderColor: '#f43f5e',
                    paddingVertical: 10,
                    borderRadius: 14,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#f43f5e', fontWeight: '700', fontSize: 14 }}>나가기</Text>
                </TouchableOpacity>
              </>
            )}

            {/* 저장된 루트 보기: 수정하기 */}
            {!isNewRoute && !isEditMode && (
              <TouchableOpacity
                onPress={() => setIsEditMode(true)}
                style={{
                  flex: 1,
                  backgroundColor: '#0ea5e9',
                  paddingVertical: 10,
                  borderRadius: 14,
                  alignItems: 'center',
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>수정하기</Text>
              </TouchableOpacity>
            )}

            {/* 편집 모드: 변경완료 + 취소 */}
            {!isNewRoute && isEditMode && (
              <>
                <TouchableOpacity
                  onPress={() => setIsEditMode(false)}
                  style={{
                    flex: 1,
                    backgroundColor: '#0ea5e9',
                    paddingVertical: 10,
                    borderRadius: 14,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>변경완료</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleEditCancel}
                  style={{
                    flex: 1,
                    borderWidth: 2,
                    borderColor: '#94a3b8',
                    paddingVertical: 10,
                    borderRadius: 14,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 14 }}>취소</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

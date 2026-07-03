import { useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MapPin, Calendar, Sparkles, Trash2 } from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { getMyRoutes, deleteRoute } from '@/lib/api/routes';
import { getTripStatusLabel } from '@/lib/date';
import type { RouteListItem } from '@/types';

interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getMonth() + 1}.${s.getDate()} - ${e.getMonth() + 1}.${e.getDate()}`;
}

function RouteCard({ route }: { route: RouteListItem }) {
  const dday = getTripStatusLabel(route.startDate, route.endDate);
  const isPast = dday === '여행 완료';

  return (
    <TouchableOpacity
      className="bg-white rounded-3xl mx-6 mb-4 overflow-hidden shadow-sm border border-slate-100"
      onPress={() =>
        router.push({
          pathname: '/route/[routeId]',
          params: { routeId: route.id },
        })
      }
      activeOpacity={0.85}
    >
      <View className={`h-1.5 ${isPast ? 'bg-slate-300' : 'bg-sky-500'}`} />
      <View className="p-5">
        <View className="flex-row justify-between items-start mb-3">
          <Text className="text-lg font-bold text-slate-800 flex-1 pr-2" numberOfLines={1}>
            {route.title}
          </Text>
          <View className={`px-2.5 py-1 rounded-full ${isPast ? 'bg-slate-100' : 'bg-sky-50'}`}>
            <Text className={`text-xs font-bold ${isPast ? 'text-slate-500' : 'text-sky-600'}`}>
              {dday}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-1.5">
            <MapPin size={13} color="#64748b" />
            <Text className="text-slate-500 text-sm">{route.destination}</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Calendar size={13} color="#64748b" />
            <Text className="text-slate-500 text-sm">
              {formatDateRange(route.startDate, route.endDate)} ({route.nights}박)
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SwipeableRouteCard({
  route,
  onDelete,
}: {
  route: RouteListItem;
  onDelete: (id: string) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <TouchableOpacity
      onPress={() => {
        swipeableRef.current?.close();
        Alert.alert('루트 삭제', `"${route.title}" 루트를 삭제할까요?`, [
          { text: '취소', style: 'cancel' },
          { text: '삭제', style: 'destructive', onPress: () => onDelete(route.id) },
        ]);
      }}
      style={{
        backgroundColor: '#f43f5e',
        justifyContent: 'center',
        alignItems: 'center',
        width: 80,
        marginBottom: 16,
        marginRight: 24,
        borderRadius: 24,
      }}
    >
      <Trash2 size={20} color="white" />
      <Text style={{ color: 'white', fontSize: 11, fontWeight: '700', marginTop: 4 }}>삭제</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      <RouteCard route={route} />
    </Swipeable>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 mt-24">
      <View className="w-20 h-20 bg-sky-50 rounded-full items-center justify-center mb-5">
        <Sparkles size={36} color="#0ea5e9" />
      </View>
      <Text className="text-xl font-bold text-slate-800 mb-2">아직 루트가 없어요</Text>
      <Text className="text-slate-400 text-sm text-center mb-8">
        AI로 나만의 여행 루트를 만들어보세요
      </Text>
      <TouchableOpacity
        className="bg-sky-500 px-8 py-4 rounded-2xl"
        onPress={() => router.push('/route/create/step-1' as never)}
        activeOpacity={0.85}
      >
        <Text className="text-white font-bold">AI 루트 만들기</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RoutesScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['routes', 'all'],
    queryFn: () => getMyRoutes(0, 50),
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  const routes = data?.content ?? [];

  const handleDelete = async (routeId: string) => {
    // optimistic update: 먼저 UI에서 제거
    queryClient.setQueryData<SpringPage<RouteListItem>>(['routes', 'all'], (old) =>
      old ? { ...old, content: old.content.filter((r) => r.id !== routeId) } : old,
    );
    try {
      await deleteRoute(routeId);
    } catch {
      // 실패 시 재조회로 복구
      queryClient.invalidateQueries({ queryKey: ['routes', 'all'] });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* 헤더 */}
      <View className="flex-row items-center px-6 py-4 bg-white border-b border-slate-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800 flex-1">내 루트</Text>
        <TouchableOpacity
          onPress={() => router.push('/route/create/step-1' as never)}
          className="bg-sky-500 px-4 py-2 rounded-xl"
          activeOpacity={0.85}
        >
          <Text className="text-white text-sm font-bold">+ 새 루트</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : routes.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SwipeableRouteCard route={item} onDelete={handleDelete} />
          )}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

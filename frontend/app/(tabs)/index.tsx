import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin, Sparkles, Navigation, Calendar } from 'lucide-react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getMyRoutes } from '@/lib/api/routes';
import { getTripStatusLabel } from '@/lib/date';
import { useAuthStore } from '@/stores/useAuthStore';
import type { RouteListItem } from '@/types';

const QUICK_ACTIONS = [
  { icon: MapPin, label: '장소', color: '#f43f5e', bg: '#fff1f2' },
  { icon: Navigation, label: '루트', color: '#3b82f6', bg: '#eff6ff' },
  { icon: Sparkles, label: 'AI 계획', color: '#f59e0b', bg: '#fffbeb' },
  { icon: Search, label: '탐색', color: '#10b981', bg: '#ecfdf5' },
];

const RECOMMENDED_CITIES = [
  { id: '1', title: '도쿄 미식 탐방', emoji: '🗼', bg: '#e0f2fe' },
  { id: '2', title: '파리 예술 여행', emoji: '🗺️', bg: '#fce7f3' },
  { id: '3', title: '방콕 로컬 맛집', emoji: '🌴', bg: '#dcfce7' },
  { id: '4', title: '제주 힐링 코스', emoji: '🏔️', bg: '#fef9c3' },
];

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getMonth() + 1}.${s.getDate()} - ${e.getMonth() + 1}.${e.getDate()}`;
}

function UpcomingTripCard({ route }: { route: RouteListItem }) {
  const dday = getTripStatusLabel(route.startDate, route.endDate);
  return (
    <TouchableOpacity
      className="bg-slate-800 rounded-3xl overflow-hidden"
      onPress={() => router.push(`/route/${route.id}` as never)}
      activeOpacity={0.9}
    >
      <View className="p-5">
        <View className="flex-row gap-2 mb-3">
          <View className="bg-white/20 px-3 py-1 rounded-full">
            <Text className="text-white text-xs font-bold">{dday}</Text>
          </View>
          <View className="bg-sky-500 px-3 py-1 rounded-full flex-row items-center gap-1">
            <Sparkles size={10} color="#ffffff" />
            <Text className="text-white text-xs font-bold">AI 맞춤형</Text>
          </View>
        </View>
        <Text className="text-white text-2xl font-bold mb-2">{route.title}</Text>
        <View className="flex-row items-center gap-2">
          <Calendar size={14} color="rgba(255,255,255,0.8)" />
          <Text className="text-white/80 text-sm font-medium">
            {formatDateRange(route.startDate, route.endDate)} • {route.destination}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EmptyTripCard() {
  return (
    <TouchableOpacity
      className="bg-slate-800 rounded-3xl p-5"
      onPress={() => router.push('/route/create/step-1' as never)}
      activeOpacity={0.9}
    >
      <View className="flex-row gap-2 mb-3">
        <View className="bg-white/20 px-3 py-1 rounded-full">
          <Text className="text-white text-xs font-bold">새 여행</Text>
        </View>
      </View>
      <Text className="text-white text-2xl font-bold mb-2">새 여행 계획 만들기</Text>
      <View className="flex-row items-center gap-2">
        <Sparkles size={14} color="rgba(255,255,255,0.8)" />
        <Text className="text-white/80 text-sm font-medium">
          AI가 최적의 루트를 생성해드립니다
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['routes', 'list'],
    queryFn: () => getMyRoutes(0, 5),
    staleTime: 1000 * 60 * 2,
  });

  const upcomingRoute = data?.content[0] ?? null;
  const initial = user?.nickname?.charAt(0).toUpperCase() ?? 'C';

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 상단 헤더 */}
        <View className="pt-4 pb-6 px-6 bg-sky-100">
          <View className="flex-row justify-between items-center mb-6">
            <View>
              <Text className="text-sky-800 font-medium text-sm mb-1">
                좋은 하루예요, {user?.nickname ?? '여행자'}님
              </Text>
              <Text className="text-3xl font-bold text-slate-800">어디로 떠나볼까요?</Text>
            </View>
            <View className="w-12 h-12 rounded-full bg-sky-200 items-center justify-center">
              <Text className="text-sky-600 font-bold text-lg">{initial}</Text>
            </View>
          </View>

          {/* AI 검색창 */}
          <TouchableOpacity
            className="flex-row items-center bg-white rounded-3xl px-4 py-3 shadow-sm"
            onPress={() => router.push('/route/create/step-1' as never)}
            activeOpacity={0.8}
          >
            <Search size={20} color="#38bdf8" />
            <Text className="ml-3 flex-1 text-slate-400 font-medium text-sm">
              AI에게 일정 계획 요청하기...
            </Text>
            <View className="bg-sky-500 p-2.5 rounded-2xl">
              <Sparkles size={18} color="#ffffff" />
            </View>
          </TouchableOpacity>
        </View>

        <View className="px-6 pt-6">
          {/* 빠른 액션 */}
          <View className="flex-row justify-between mb-8">
            {QUICK_ACTIONS.map((action, i) => (
              <View key={i} className="items-center gap-2">
                <View
                  className="w-14 h-14 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: action.bg }}
                >
                  <action.icon size={24} color={action.color} />
                </View>
                <Text className="text-xs font-bold text-slate-600">{action.label}</Text>
              </View>
            ))}
          </View>

          {/* 다가오는 여행 */}
          <View className="mb-8">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-slate-800">다가오는 여행</Text>
              <TouchableOpacity onPress={() => router.push('/routes' as never)}>
                <Text className="text-sky-500 text-sm font-bold">전체보기</Text>
              </TouchableOpacity>
            </View>

            {isLoading ? (
              <View className="bg-slate-100 rounded-3xl p-8 items-center">
                <ActivityIndicator size="small" color="#0ea5e9" />
              </View>
            ) : isError ? (
              <TouchableOpacity
                className="bg-slate-100 rounded-3xl p-8 items-center"
                onPress={() => refetch()}
                activeOpacity={0.85}
              >
                <Text className="text-slate-500 text-sm">불러오지 못했어요, 다시 시도</Text>
              </TouchableOpacity>
            ) : upcomingRoute ? (
              <UpcomingTripCard route={upcomingRoute} />
            ) : (
              <EmptyTripCard />
            )}
          </View>

          {/* 당신을 위한 추천 */}
          <View className="mb-8">
            <Text className="text-lg font-bold text-slate-800 mb-4">당신을 위한 추천</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6">
              {RECOMMENDED_CITIES.map((city) => (
                <TouchableOpacity
                  key={city.id}
                  className="mr-3 w-36 h-44 rounded-3xl items-center justify-center"
                  style={{ backgroundColor: city.bg }}
                  activeOpacity={0.8}
                >
                  <Text className="text-5xl mb-3">{city.emoji}</Text>
                  <Text className="text-slate-700 font-bold text-sm text-center px-3">
                    {city.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View className="h-6" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

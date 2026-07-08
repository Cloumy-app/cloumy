import { View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GripVertical, MapPin, Calendar } from 'lucide-react-native';
import type { RouteListItem } from '@/types';

// RouteCard(routes/index.tsx 로컬 컴포넌트) 한 장의 대략적인 렌더 높이(margin 포함) —
// 드래그 중 몇 칸을 이동했는지 계산하는 기준값. 실제 카드 높이가 이 값과 정확히 같을
// 필요는 없다(내용에 따라 약간 다를 수 있어도 반올림 계산이라 오차에 관대함).
const ROW_HEIGHT = 112;

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getMonth() + 1}.${s.getDate()} - ${e.getMonth() + 1}.${e.getDate()}`;
}

function DraggableRow({
  route,
  index,
  count,
  onMove,
}: {
  route: RouteListItem;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const rawOffset = Math.round(translateY.value / ROW_HEIGHT);
      const targetIndex = Math.min(Math.max(index + rawOffset, 0), count - 1);
      translateY.value = withTiming(0, { duration: 150 });
      isDragging.value = false;
      if (targetIndex !== index) {
        runOnJS(onMove)(index, targetIndex);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isDragging.value ? 10 : 0,
    shadowOpacity: isDragging.value ? 0.15 : 0,
    shadowRadius: 8,
    elevation: isDragging.value ? 4 : 0,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <View className="flex-row items-center mx-6 mb-4">
        <GestureDetector gesture={panGesture}>
          <View className="pr-3 py-2" hitSlop={8}>
            <GripVertical size={20} color="#94a3b8" />
          </View>
        </GestureDetector>
        <View className="flex-1 bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
          <View className="p-5">
            <Text className="text-lg font-bold text-slate-800 mb-3" numberOfLines={1}>
              {route.title}
            </Text>
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
        </View>
      </View>
    </Animated.View>
  );
}

export function ReorderableRouteList({
  routes,
  onOrderChange,
}: {
  routes: RouteListItem[];
  onOrderChange: (newOrder: RouteListItem[]) => void;
}) {
  const handleMove = (from: number, to: number) => {
    const next = [...routes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onOrderChange(next);
  };

  return (
    <View style={{ paddingTop: 16, paddingBottom: 32 }}>
      {routes.map((route, index) => (
        <DraggableRow
          key={route.id}
          route={route}
          index={index}
          count={routes.length}
          onMove={handleMove}
        />
      ))}
    </View>
  );
}

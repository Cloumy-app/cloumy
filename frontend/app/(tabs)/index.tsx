import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin, Sparkles, Navigation, Calendar } from 'lucide-react-native';
import { router } from 'expo-router';

const QUICK_ACTIONS = [
  { icon: MapPin, label: '장소', color: '#f43f5e', bg: '#fff1f2' },
  { icon: Navigation, label: '루트', color: '#3b82f6', bg: '#eff6ff' },
  { icon: Sparkles, label: 'AI 계획', color: '#f59e0b', bg: '#fffbeb' },
  { icon: Search, label: '탐색', color: '#10b981', bg: '#ecfdf5' },
];

export default function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 상단 그라디언트 영역 */}
        <View className="pt-4 pb-6 px-6 bg-sky-100">
          <View className="flex-row justify-between items-center mb-6">
            <View>
              <Text className="text-sky-800 font-medium text-sm mb-1">좋은 하루예요, 여행자님</Text>
              <Text className="text-3xl font-bold text-slate-800">어디로 떠나볼까요?</Text>
            </View>
            <View className="w-12 h-12 rounded-full bg-sky-200 items-center justify-center">
              <Text className="text-sky-600 font-bold text-lg">C</Text>
            </View>
          </View>

          {/* AI 루트 생성 입력창 */}
          <TouchableOpacity
            className="flex-row items-center bg-white rounded-3xl px-4 py-3 shadow-sm"
            onPress={() => router.push('/route/create/step-1')}
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

        <View className="px-6 pt-6 space-y-8">
          {/* 빠른 액션 */}
          <View className="flex-row justify-between">
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
          <View className="mt-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-slate-800">다가오는 여행</Text>
              <TouchableOpacity>
                <Text className="text-sky-500 text-sm font-bold">전체보기</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              className="bg-slate-800 rounded-3xl p-5 overflow-hidden"
              onPress={() => router.push('/route/create/step-1')}
              activeOpacity={0.9}
            >
              <View className="flex-row gap-2 mb-3">
                <View className="bg-white/20 px-3 py-1 rounded-full">
                  <Text className="text-white text-xs font-bold">AI 맞춤형</Text>
                </View>
              </View>
              <Text className="text-white text-2xl font-bold mb-2">새 여행 계획 만들기</Text>
              <View className="flex-row items-center gap-2">
                <Sparkles size={14} color="#ffffff" />
                <Text className="text-white/80 text-sm font-medium">
                  AI가 최적의 루트를 생성해드립니다
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* 하단 여백 */}
          <View className="h-6" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

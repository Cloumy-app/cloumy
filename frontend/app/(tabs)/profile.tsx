import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, LogOut, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '@/stores/useAuthStore';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const initial = user?.nickname?.charAt(0).toUpperCase() ?? 'C';

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* 상단 프로필 카드 */}
        <View className="bg-white mx-6 mt-6 rounded-3xl p-6 items-center shadow-sm border border-slate-100">
          <View className="w-20 h-20 rounded-full bg-sky-100 items-center justify-center mb-4">
            <Text className="text-sky-600 font-bold text-3xl">{initial}</Text>
          </View>
          <Text className="text-xl font-bold text-slate-800 mb-1">
            {user?.nickname ?? '여행자'}
          </Text>
          <Text className="text-sm text-slate-400">Cloumy 여행자</Text>
        </View>

        {/* 내 루트 섹션 */}
        <View className="mx-6 mt-6">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            내 루트
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <TouchableOpacity
              className="flex-row items-center px-5 py-4 gap-3"
              onPress={() => router.push('/routes' as never)}
              activeOpacity={0.7}
            >
              <View className="w-9 h-9 rounded-xl bg-sky-50 items-center justify-center">
                <MapPin size={18} color="#0ea5e9" />
              </View>
              <Text className="flex-1 font-semibold text-slate-700">내 루트 보기</Text>
              <ChevronRight size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 계정 섹션 */}
        <View className="mx-6 mt-4 mb-8">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
            계정
          </Text>
          <View className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <TouchableOpacity
              className="flex-row items-center px-5 py-4 gap-3"
              onPress={logout}
              activeOpacity={0.7}
            >
              <View className="w-9 h-9 rounded-xl bg-rose-50 items-center justify-center">
                <LogOut size={18} color="#f43f5e" />
              </View>
              <Text className="flex-1 font-semibold text-rose-500">로그아웃</Text>
              <ChevronRight size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

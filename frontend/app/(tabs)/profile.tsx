import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, LogOut } from 'lucide-react-native';
import { useAuthStore } from '@/stores/useAuthStore';

export default function ProfileScreen() {
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
  };

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center">
      <User size={48} color="#94a3b8" />
      <Text className="text-slate-400 font-medium mt-4">프로필 준비 중</Text>

      <TouchableOpacity
        className="flex-row items-center gap-2 mt-12 px-6 py-3 bg-slate-100 rounded-xl"
        onPress={handleLogout}
      >
        <LogOut size={16} color="#64748b" />
        <Text className="text-slate-500 font-medium text-sm">로그아웃</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

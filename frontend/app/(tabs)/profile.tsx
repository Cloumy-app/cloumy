import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User } from 'lucide-react-native';

export default function ProfileScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center">
      <User size={48} color="#94a3b8" />
      <Text className="text-slate-400 font-medium mt-4">프로필 준비 중</Text>
    </SafeAreaView>
  );
}

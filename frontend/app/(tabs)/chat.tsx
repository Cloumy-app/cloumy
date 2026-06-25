import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle } from 'lucide-react-native';

export default function ChatScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center">
      <MessageCircle size={48} color="#94a3b8" />
      <Text className="text-slate-400 font-medium mt-4">AI 챗봇 준비 중</Text>
    </SafeAreaView>
  );
}

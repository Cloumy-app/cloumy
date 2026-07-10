import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import { getMyBookmarks, removeBookmark } from '@/lib/api/explore';
import { PlaceBrowseCard } from '@/components/explore/PlaceBrowseCard';
import type { PlaceBrowseItem } from '@/types';

const QUERY_KEY = ['bookmarks'];

export default function BookmarksScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getMyBookmarks(0),
    staleTime: 1000 * 60,
  });

  const places = data?.content ?? [];

  const handleToggleBookmark = async (place: PlaceBrowseItem) => {
    // 이 화면은 전부 북마크된 장소만 보여주므로, 해제 시 목록에서 즉시 제거
    queryClient.setQueryData<{ content: PlaceBrowseItem[] } | undefined>(QUERY_KEY, (prev) =>
      prev ? { ...prev, content: prev.content.filter((p) => p.id !== place.id) } : prev,
    );
    try {
      await removeBookmark(place.id);
    } catch {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800">{t('bookmarks.headerTitle')}</Text>
      </View>

      {!isLoading && places.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-slate-400 font-medium">{t('bookmarks.emptyState')}</Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <PlaceBrowseCard
              place={item}
              onToggleBookmark={() => handleToggleBookmark(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Users, Bookmark, Plus } from 'lucide-react-native';
import { getPublicRoutes } from '@/lib/api/routes';
import type { PublicRouteListItem } from '@/types';

const PAGE_SIZE = 10;

function CommunityRouteCard({ route }: { route: PublicRouteListItem }) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      className="bg-white rounded-3xl mx-6 mb-4 p-5 shadow-sm border border-slate-100"
      onPress={() =>
        router.push({
          pathname: '/community/[routeId]',
          params: {
            routeId: route.id,
            title: route.title,
            destination: route.destination,
            nights: String(route.nights),
            saveCount: String(route.saveCount),
          },
        })
      }
      activeOpacity={0.85}
    >
      <Text className="text-lg font-bold text-slate-800 mb-2" numberOfLines={1}>
        {route.title}
      </Text>
      <View className="flex-row items-center gap-4 mb-2">
        <Text className="text-slate-500 text-sm">{route.destination}</Text>
        <View className="flex-row items-center gap-1">
          <Users size={12} color="#94a3b8" />
          <Text className="text-xs text-slate-400">
            {t('community.nightsLabel', { nights: route.nights })}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Bookmark size={12} color="#94a3b8" />
          <Text className="text-xs text-slate-400">{route.saveCount}</Text>
        </View>
      </View>
      {route.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1">
          {route.tags.map((tag) => (
            <View key={tag} className="bg-slate-50 px-2 py-0.5 rounded-full">
              <Text className="text-[10px] text-slate-500">{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

function EmptyState({ t }: { t: (key: string) => string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 mt-24">
      <Text className="text-xl font-bold text-slate-800 mb-2">{t('community.emptyTitle')}</Text>
      <Text className="text-slate-400 text-sm text-center">{t('community.emptySubtitle')}</Text>
    </View>
  );
}

export default function CommunityScreen() {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['community', 'feed'],
    queryFn: ({ pageParam }) => getPublicRoutes(undefined, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.last ? undefined : allPages.length),
    staleTime: 1000 * 60 * 2,
  });

  const routes = data?.pages.flatMap((p) => p.content) ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-row items-center px-6 py-4 bg-white border-b border-slate-100">
        <Text className="text-xl font-bold text-slate-800 flex-1">{t('community.headerTitle')}</Text>
        <TouchableOpacity
          onPress={() => router.push('/community/create')}
          className="flex-row items-center gap-1 bg-sky-500 px-4 py-2 rounded-xl"
          activeOpacity={0.85}
        >
          <Plus size={14} color="#ffffff" />
          <Text className="text-white text-sm font-bold">{t('community.createButton')}</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8 mt-24">
          <Text className="text-slate-500 text-sm text-center mb-6">{t('community.loadError')}</Text>
          <TouchableOpacity className="bg-slate-800 px-6 py-3 rounded-2xl" onPress={() => refetch()} activeOpacity={0.85}>
            <Text className="text-white font-bold">{t('community.retryButton')}</Text>
          </TouchableOpacity>
        </View>
      ) : routes.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CommunityRouteCard route={item} />}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null}
        />
      )}
    </SafeAreaView>
  );
}

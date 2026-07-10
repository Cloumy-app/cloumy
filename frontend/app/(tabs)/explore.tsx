import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass } from 'lucide-react-native';
import { browsePlaces, getMyBookmarks, addBookmark, removeBookmark } from '@/lib/api/explore';
import { PlaceBrowseCard } from '@/components/explore/PlaceBrowseCard';
import { PlaceDetailSheet } from '@/components/route/PlaceDetailSheet';
import { useAuthStore } from '@/stores/useAuthStore';
import { EXPLORE_CATEGORY_TAGS, PERSONA_EXPLORE_TAG_MAP, type PersonaTag } from '@/lib/constants/personaTags';
import type { PlaceBrowseItem } from '@/types';

// step-1.tsx의 CITIES와 동일 — 백엔드 CityCenters.COORDS(14개)의 부분집합이라 항상 유효
const CITIES = ['서울', '부산', '제주', '경주', '강릉', '전주', '여수', '속초', '춘천', '거제'];

export default function ExploreScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const preselectedTags = useMemo(() => {
    const tags = new Set<string>();
    for (const persona of user?.personaTags ?? []) {
      (PERSONA_EXPLORE_TAG_MAP[persona as PersonaTag] ?? []).forEach((t2) => tags.add(t2));
    }
    return Array.from(tags);
  }, [user?.personaTags]);

  const [city, setCity] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(preselectedTags);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const queryKey = ['explore', city, tags, showBookmarksOnly];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => (showBookmarksOnly ? getMyBookmarks(0) : browsePlaces(city!, tags, 0)),
    enabled: showBookmarksOnly || !!city,
    staleTime: 1000 * 60,
  });

  const places = data?.content ?? [];

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t2) => t2 !== tag) : [...prev, tag]));
  };

  const handleToggleBookmark = async (place: PlaceBrowseItem) => {
    const nextBookmarked = !place.isBookmarked;
    queryClient.setQueryData<{ content: PlaceBrowseItem[] } | undefined>(queryKey, (prev) =>
      prev ? { ...prev, content: prev.content.map((p) => (p.id === place.id ? { ...p, isBookmarked: nextBookmarked } : p)) } : prev,
    );
    try {
      await (nextBookmarked ? addBookmark(place.id) : removeBookmark(place.id));
    } catch {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="px-6 pt-4 pb-2">
        <Text className="text-xl font-bold text-slate-800 mb-3">{t('explore.headerTitle')}</Text>

        {/* 전체/내 북마크 토글 */}
        <View className="flex-row bg-slate-100 rounded-2xl p-1 mb-3">
          {(['all', 'bookmarks'] as const).map((mode) => {
            const selected = (mode === 'bookmarks') === showBookmarksOnly;
            return (
              <TouchableOpacity
                key={mode}
                onPress={() => setShowBookmarksOnly(mode === 'bookmarks')}
                className={`flex-1 py-2 rounded-xl items-center ${selected ? 'bg-white shadow-sm' : ''}`}
              >
                <Text className={`text-sm font-bold ${selected ? 'text-sky-600' : 'text-slate-400'}`}>
                  {t(mode === 'all' ? 'explore.tabAll' : 'explore.tabBookmarks')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {!showBookmarksOnly && (
          <>
            {/* 도시 선택 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2 -mx-1">
              {CITIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCity(c)}
                  className={`mx-1 px-4 py-2 rounded-2xl border-2 ${city === c ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'}`}
                >
                  <Text className={`text-sm font-bold ${city === c ? 'text-sky-700' : 'text-slate-600'}`}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* 테마 필터 칩 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
              {EXPLORE_CATEGORY_TAGS.map((tag) => {
                const selected = tags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    className={`mx-1 px-3 py-1.5 rounded-xl border ${selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'}`}
                  >
                    <Text className={`text-xs font-semibold ${selected ? 'text-sky-600' : 'text-slate-500'}`}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>

      {!showBookmarksOnly && !city ? (
        <View className="flex-1 items-center justify-center px-8">
          <Compass size={40} color="#94a3b8" />
          <Text className="text-slate-400 font-medium mt-3">{t('explore.selectCityPrompt')}</Text>
        </View>
      ) : !isLoading && places.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-slate-400 font-medium">{t('explore.emptyState')}</Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <PlaceBrowseCard
              place={item}
              onPress={() => setSelectedPlaceId(item.id)}
              onToggleBookmark={() => handleToggleBookmark(item)}
            />
          )}
        />
      )}

      <PlaceDetailSheet placeId={selectedPlaceId} onClose={() => setSelectedPlaceId(null)} />
    </SafeAreaView>
  );
}

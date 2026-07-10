import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, Users, Bookmark, Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { getPublicRoutes, getPublicRouteSlots, addRouteBookmark, removeRouteBookmark } from '@/lib/api/routes';
import { getBookmarksByCity } from '@/lib/api/explore';
import { useImportedSlotsStore } from '@/stores/useImportedSlotsStore';
import { SearchPlaceTab } from '@/components/route/SearchPlaceTab';
import { DayPickerConfirm } from '@/components/route/DayPickerConfirm';
import type { PlaceBrowseItem, PublicRouteListItem, SlotWithCoords } from '@/types';

export default function RouteCreateImportSlots() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    destination: string;
    nights: string;
    groupType: string;
    startDate: string;
    endDate: string;
    sourceRouteId?: string;
    sourceRouteTitle?: string;
  }>();

  const nightsNum = Number(params.nights ?? 1);
  const dayCount = Math.max(nightsNum + 1, 1);

  const [activeTab, setActiveTab] = useState<'import' | 'bookmarkedPlaces' | 'search'>('import');

  const [loading, setLoading] = useState(true);
  const [publicRoutes, setPublicRoutes] = useState<PublicRouteListItem[]>([]);
  const [showBookmarkedRoutesOnly, setShowBookmarkedRoutesOnly] = useState(false);

  const [openRoute, setOpenRoute] = useState<PublicRouteListItem | null>(null);
  const [openRouteSlots, setOpenRouteSlots] = useState<SlotWithCoords[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // placeId -> 새 여행의 day_number (체크된 슬롯만 키를 가짐)
  const [dayByPlace, setDayByPlace] = useState<Record<string, number>>({});

  const [loadingBookmarkedPlaces, setLoadingBookmarkedPlaces] = useState(false);
  const [bookmarkedPlaces, setBookmarkedPlaces] = useState<PlaceBrowseItem[]>([]);
  const [pendingPlace, setPendingPlace] = useState<PlaceBrowseItem | null>(null);

  const { slots: imported, addSlot, removeSlot } = useImportedSlotsStore();
  const importedIds = new Set(imported.map((s) => s.placeId));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const routes = await getPublicRoutes(params.destination ?? '서울', showBookmarkedRoutesOnly, 0, 10);
        if (!cancelled) setPublicRoutes(routes.content);
      } catch {
        if (!cancelled) setPublicRoutes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.destination, showBookmarkedRoutesOnly]);

  useEffect(() => {
    if (activeTab !== 'bookmarkedPlaces') return;
    let cancelled = false;
    (async () => {
      setLoadingBookmarkedPlaces(true);
      try {
        const page = await getBookmarksByCity(params.destination ?? '서울');
        if (!cancelled) setBookmarkedPlaces(page.content);
      } catch {
        if (!cancelled) setBookmarkedPlaces([]);
      } finally {
        if (!cancelled) setLoadingBookmarkedPlaces(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, params.destination]);

  // 루트/커뮤니티 탭 신설 — 커뮤니티 미리보기의 "선택해서 가져오기"로 진입한 경우, 공개 루트
  // 목록 단계를 건너뛰고 바로 이 루트가 열린 상태로 시작. nights/tags/saveCount는 이 뷰에서
  // 렌더링에 쓰이지 않는 더미값이라 채워도 안전.
  useEffect(() => {
    if (!params.sourceRouteId || !params.sourceRouteTitle) return;
    let cancelled = false;
    (async () => {
      try {
        const slots = await getPublicRouteSlots(params.sourceRouteId!);
        if (cancelled) return;
        setOpenRoute({
          id: params.sourceRouteId!,
          title: params.sourceRouteTitle!,
          destination: params.destination ?? '',
          nights: 0,
          tags: [],
          saveCount: 0,
          isBookmarked: false,
        });
        setOpenRouteSlots(slots);
        const defaults: Record<string, number> = {};
        slots.forEach((s) => {
          defaults[s.placeId] = Math.min(s.dayNumber, dayCount);
        });
        setDayByPlace(defaults);
      } catch {
        if (!cancelled) {
          Alert.alert(t('routeCreateImport.sourceRouteUnavailableTitle'), t('routeCreateImport.sourceRouteUnavailableBody'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpenRoute = async (route: PublicRouteListItem) => {
    setOpenRoute(route);
    setLoadingSlots(true);
    try {
      const slots = await getPublicRouteSlots(route.id);
      setOpenRouteSlots(slots);
      // 원래 day 번호를 새 여행 박수 범위로 클램프한 기본값으로 미리 채워둠
      const defaults: Record<string, number> = {};
      slots.forEach((s) => {
        defaults[s.placeId] = Math.min(s.dayNumber, dayCount);
      });
      setDayByPlace(defaults);
    } catch {
      setOpenRouteSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const toggleRouteBookmark = async (route: PublicRouteListItem) => {
    const nextBookmarked = !route.isBookmarked;
    setPublicRoutes((prev) =>
      prev.map((r) => (r.id === route.id ? { ...r, isBookmarked: nextBookmarked } : r)),
    );
    try {
      await (nextBookmarked ? addRouteBookmark(route.id) : removeRouteBookmark(route.id));
    } catch {
      setPublicRoutes((prev) =>
        prev.map((r) => (r.id === route.id ? { ...r, isBookmarked: route.isBookmarked } : r)),
      );
    }
  };

  const toggleSlot = (slot: SlotWithCoords) => {
    if (!openRoute) return;
    if (importedIds.has(slot.placeId)) {
      removeSlot(slot.placeId);
      return;
    }
    addSlot({
      placeId: slot.placeId,
      placeName: slot.placeName,
      dayNumber: dayByPlace[slot.placeId] ?? 1,
      sourceRouteId: openRoute.id,
    });
  };

  const toggleSelectAll = () => {
    if (!openRoute) return;
    const allSelected = openRouteSlots.every((s) => importedIds.has(s.placeId));
    if (allSelected) {
      openRouteSlots.forEach((s) => removeSlot(s.placeId));
    } else {
      openRouteSlots.forEach((s) => {
        if (!importedIds.has(s.placeId)) {
          addSlot({
            placeId: s.placeId,
            placeName: s.placeName,
            dayNumber: dayByPlace[s.placeId] ?? 1,
            sourceRouteId: openRoute.id,
          });
        }
      });
    }
  };

  const onChangeDay = (slot: SlotWithCoords, dayNumber: number) => {
    setDayByPlace((prev) => ({ ...prev, [slot.placeId]: dayNumber }));
    if (importedIds.has(slot.placeId) && openRoute) {
      removeSlot(slot.placeId);
      addSlot({ placeId: slot.placeId, placeName: slot.placeName, dayNumber, sourceRouteId: openRoute.id });
    }
  };

  const onConfirmBookmarkedPlaceDay = (day: number) => {
    if (!pendingPlace) return;
    addSlot({ placeId: pendingPlace.id, placeName: pendingPlace.name, dayNumber: day });
    setPendingPlace(null);
  };

  const goNext = () => {
    router.push({ pathname: '/route/create/step-2', params });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity
          onPress={() => (openRoute ? setOpenRoute(null) : router.back())}
          className="mr-4"
        >
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 2 / 5</Text>
          <Text className="text-xl font-bold text-slate-800">
            {openRoute
              ? openRoute.title
              : activeTab === 'search'
                ? t('routeCreateImport.searchTab')
                : activeTab === 'bookmarkedPlaces'
                  ? t('routeCreateImport.bookmarkedPlacesTab')
                  : t('routeCreateImport.headerTitle')}
          </Text>
        </View>
        {imported.length > 0 && (
          <View className="bg-sky-500 px-3 py-1 rounded-full">
            <Text className="text-white font-bold text-xs">{imported.length}</Text>
          </View>
        )}
      </View>

      {!openRoute && (
        <View className="flex-row px-6 mb-4 gap-2">
          <TouchableOpacity
            onPress={() => setActiveTab('import')}
            className={`flex-1 py-2.5 rounded-xl items-center border-2 ${
              activeTab === 'import' ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
            }`}
          >
            <Text className={`text-sm font-bold ${activeTab === 'import' ? 'text-sky-600' : 'text-slate-500'}`}>
              {t('routeCreateImport.importTab')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('bookmarkedPlaces')}
            className={`flex-1 py-2.5 rounded-xl items-center border-2 ${
              activeTab === 'bookmarkedPlaces' ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
            }`}
          >
            <Text className={`text-sm font-bold ${activeTab === 'bookmarkedPlaces' ? 'text-sky-600' : 'text-slate-500'}`}>
              {t('routeCreateImport.bookmarkedPlacesTab')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('search')}
            className={`flex-1 py-2.5 rounded-xl items-center border-2 ${
              activeTab === 'search' ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
            }`}
          >
            <Text className={`text-sm font-bold ${activeTab === 'search' ? 'text-sky-600' : 'text-slate-500'}`}>
              {t('routeCreateImport.searchTab')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'search' ? (
        <SearchPlaceTab dayCount={dayCount} />
      ) : activeTab === 'bookmarkedPlaces' ? (
        pendingPlace ? (
          <DayPickerConfirm
            name={pendingPlace.name}
            address={pendingPlace.address}
            dayCount={dayCount}
            onConfirmDay={onConfirmBookmarkedPlaceDay}
            onCancel={() => setPendingPlace(null)}
          />
        ) : (
          <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
            {loadingBookmarkedPlaces && (
              <View className="items-center py-10">
                <ActivityIndicator />
              </View>
            )}

            {!loadingBookmarkedPlaces && bookmarkedPlaces.length === 0 && (
              <View className="items-center py-10">
                <Text className="text-sm text-slate-400">{t('routeCreateImport.noBookmarkedPlaces')}</Text>
              </View>
            )}

            {bookmarkedPlaces.map((place) => (
              <TouchableOpacity
                key={place.id}
                onPress={() => setPendingPlace(place)}
                className="border-2 border-slate-100 rounded-2xl px-4 py-4 mb-3"
                activeOpacity={0.8}
              >
                <Text className="font-bold text-slate-800 mb-1">{place.name}</Text>
                {place.address && (
                  <Text className="text-xs text-slate-400" numberOfLines={1}>{place.address}</Text>
                )}
              </TouchableOpacity>
            ))}

            <View className="h-4" />
          </ScrollView>
        )
      ) : !openRoute ? (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          <Text className="text-xs text-slate-400 mb-3">{t('routeCreateImport.hint')}</Text>

          <View className="flex-row bg-slate-100 rounded-2xl p-1 mb-4">
            {(['all', 'bookmarked'] as const).map((mode) => {
              const selected = (mode === 'bookmarked') === showBookmarkedRoutesOnly;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setShowBookmarkedRoutesOnly(mode === 'bookmarked')}
                  className="flex-1 py-2 rounded-xl items-center"
                  style={
                    selected
                      ? {
                          backgroundColor: '#ffffff',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.08,
                          shadowRadius: 2,
                          elevation: 1,
                        }
                      : undefined
                  }
                >
                  <Text className={`text-sm font-bold ${selected ? 'text-sky-600' : 'text-slate-400'}`}>
                    {t(mode === 'all' ? 'routeCreateImport.routesTabAll' : 'routeCreateImport.routesTabBookmarked')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {loading && (
            <View className="items-center py-10">
              <ActivityIndicator />
            </View>
          )}

          {!loading && publicRoutes.length === 0 && (
            <View className="items-center py-10">
              <Text className="text-sm text-slate-400">
                {showBookmarkedRoutesOnly
                  ? t('routeCreateImport.noBookmarkedRoutes')
                  : t('routeCreateImport.noPublicRoutes')}
              </Text>
            </View>
          )}

          {publicRoutes.map((route) => (
            <View key={route.id} className="border-2 border-slate-100 rounded-2xl px-4 py-4 mb-3">
              <View className="flex-row items-start justify-between">
                <TouchableOpacity
                  onPress={() => onOpenRoute(route)}
                  className="flex-1 mr-3"
                  activeOpacity={0.8}
                >
                  <Text className="font-bold text-slate-800 mb-1">{route.title}</Text>
                  <View className="flex-row items-center gap-3 mb-2">
                    <View className="flex-row items-center gap-1">
                      <Users size={12} color="#94a3b8" />
                      <Text className="text-xs text-slate-400">
                        {t('routeCreateImport.nightsLabel', { nights: route.nights })}
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
                <TouchableOpacity onPress={() => toggleRouteBookmark(route)} hitSlop={8}>
                  <Heart
                    size={20}
                    color={route.isBookmarked ? '#f43f5e' : '#cbd5e1'}
                    fill={route.isBookmarked ? '#f43f5e' : 'none'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View className="h-4" />
        </ScrollView>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {loadingSlots ? (
            <View className="items-center py-10">
              <ActivityIndicator />
            </View>
          ) : (
            <>
              <TouchableOpacity
                onPress={toggleSelectAll}
                className="flex-row items-center gap-2 mb-4"
                activeOpacity={0.8}
              >
                <View
                  className={`w-5 h-5 rounded-md border-2 items-center justify-center ${
                    openRouteSlots.length > 0 && openRouteSlots.every((s) => importedIds.has(s.placeId))
                      ? 'bg-sky-500 border-sky-500'
                      : 'border-slate-300'
                  }`}
                >
                  {openRouteSlots.length > 0 && openRouteSlots.every((s) => importedIds.has(s.placeId)) && (
                    <Check size={12} color="#ffffff" />
                  )}
                </View>
                <Text className="text-sm font-semibold text-slate-600">{t('routeCreateImport.selectAll')}</Text>
              </TouchableOpacity>

              {openRouteSlots.map((slot) => {
                const checked = importedIds.has(slot.placeId);
                const day = dayByPlace[slot.placeId] ?? 1;
                return (
                  <View key={slot.id} className="border-2 border-slate-100 rounded-2xl px-4 py-3 mb-3">
                    <View className="flex-row items-start">
                      <TouchableOpacity
                        onPress={() => toggleSlot(slot)}
                        className={`w-5 h-5 rounded-md border-2 items-center justify-center mr-3 mt-0.5 ${
                          checked ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                        }`}
                      >
                        {checked && <Check size={12} color="#ffffff" />}
                      </TouchableOpacity>
                      <View className="flex-1">
                        <Text className="font-bold text-slate-800 text-sm mb-0.5">{slot.placeName}</Text>
                        <Text className="text-xs text-slate-400 mb-2">
                          {t('routeCreateImport.originalDay', { day: slot.dayNumber })}
                        </Text>
                        <View className="flex-row flex-wrap gap-1.5">
                          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                            <TouchableOpacity
                              key={d}
                              onPress={() => onChangeDay(slot, d)}
                              className={`px-2.5 py-1 rounded-full border ${
                                day === d ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
                              }`}
                            >
                              <Text
                                className={`text-[11px] font-bold ${
                                  day === d ? 'text-sky-600' : 'text-slate-400'
                                }`}
                              >
                                {t('routeCreateImport.dayChip', { day: d })}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
              <View className="h-4" />
            </>
          )}
        </ScrollView>
      )}

      <View className="px-6 pb-8">
        <TouchableOpacity onPress={goNext} className="bg-sky-500 py-4 rounded-2xl items-center" activeOpacity={0.9}>
          <Text className="text-white font-bold text-base">
            {imported.length > 0 ? t('routeCreateImport.nextWithCount', { count: imported.length }) : t('routeCreateImport.skip')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

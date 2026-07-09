import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Check, Users2, Download } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { getPublicRoutes, getPublicRouteSlots } from '@/lib/api/routes';
import { useImportedSlotsStore } from '@/stores/useImportedSlotsStore';
import type { PublicRouteListItem, SlotWithCoords } from '@/types';

export default function ImportSlotsStep() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    destination: string; groupType: string; startDate: string; endDate: string; nights: string;
  }>();
  const totalDays = Number(params.nights ?? 1) + 1;

  const items = useImportedSlotsStore((s) => s.items);
  const addItem = useImportedSlotsStore((s) => s.add);
  const removeItem = useImportedSlotsStore((s) => s.remove);

  const [routes, setRoutes] = useState<PublicRouteListItem[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [openRoute, setOpenRoute] = useState<PublicRouteListItem | null>(null);
  const [openRouteSlots, setOpenRouteSlots] = useState<SlotWithCoords[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dayByPlace, setDayByPlace] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    if (!params.destination) return;
    getPublicRoutes(params.destination)
      .then((page) => { if (!cancelled) setRoutes(page.content); })
      .finally(() => { if (!cancelled) setLoadingRoutes(false); });
    return () => { cancelled = true; };
  }, [params.destination]);

  const importedPlaceIds = new Set(items.map((i) => i.placeId));

  const onOpenRoute = async (route: PublicRouteListItem) => {
    setOpenRoute(route);
    setLoadingSlots(true);
    setChecked(new Set());
    setDayByPlace({});
    try {
      const slots = await getPublicRouteSlots(route.id);
      setOpenRouteSlots(slots);
    } finally {
      setLoadingSlots(false);
    }
  };

  const allChecked = openRouteSlots.length > 0 && checked.size === openRouteSlots.length;

  const toggleAll = () => {
    if (allChecked) {
      setChecked(new Set());
    } else {
      setChecked(new Set(openRouteSlots.map((s) => s.placeId)));
      setDayByPlace((prev) => {
        const next = { ...prev };
        openRouteSlots.forEach((s) => { if (!next[s.placeId]) next[s.placeId] = 1; });
        return next;
      });
    }
  };

  const toggleOne = (placeId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
        setDayByPlace((d) => (d[placeId] ? d : { ...d, [placeId]: 1 }));
      }
      return next;
    });
  };

  const onConfirmImport = () => {
    if (!openRoute) return;
    for (const slot of openRouteSlots) {
      if (!checked.has(slot.placeId)) continue;
      addItem({
        placeId: slot.placeId,
        placeName: slot.placeName,
        dayNumber: dayByPlace[slot.placeId] ?? 1,
        sourceRouteId: openRoute.id,
      });
    }
    setOpenRoute(null);
  };

  const goNext = () => {
    router.push({ pathname: '/route/create/step-2', params });
  };

  if (openRoute) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-row items-center px-6 py-4">
          <TouchableOpacity onPress={() => setOpenRoute(null)} className="mr-4">
            <ChevronLeft size={24} color="#475569" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-xl font-bold text-slate-800" numberOfLines={1}>{openRoute.title}</Text>
          </View>
          <TouchableOpacity onPress={toggleAll} className="px-3 py-1.5 rounded-full bg-slate-100">
            <Text className="text-xs font-bold text-slate-600">
              {allChecked ? t('routeCreateImport.deselectAll') : t('routeCreateImport.selectAll')}
            </Text>
          </TouchableOpacity>
        </View>

        {loadingSlots ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color="#0ea5e9" /></View>
        ) : (
          <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 24 }}>
            {openRouteSlots.map((slot) => {
              const isChecked = checked.has(slot.placeId);
              const alreadyImported = importedPlaceIds.has(slot.placeId);
              return (
                <View key={slot.id} className="mb-3 border border-slate-100 rounded-2xl px-4 py-3">
                  <TouchableOpacity
                    onPress={() => !alreadyImported && toggleOne(slot.placeId)}
                    disabled={alreadyImported}
                    className="flex-row items-center gap-3"
                    activeOpacity={0.7}
                  >
                    <View
                      className={`w-6 h-6 rounded-full items-center justify-center border-2 ${
                        isChecked || alreadyImported ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                      }`}
                    >
                      {(isChecked || alreadyImported) && <Check size={14} color="#fff" />}
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold text-sm text-slate-700">{slot.placeName}</Text>
                      <Text className="text-xs text-slate-400 mt-0.5">
                        {t('routeCreateImport.dayLabel', { day: slot.dayNumber })}
                        {alreadyImported ? ` · ${t('routeCreateImport.alreadyImported')}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {isChecked && !alreadyImported && (
                    <View className="flex-row flex-wrap gap-2 mt-3 ml-9">
                      {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => (
                        <TouchableOpacity
                          key={day}
                          onPress={() => setDayByPlace((d) => ({ ...d, [slot.placeId]: day }))}
                          className={`px-3 py-1.5 rounded-xl border ${
                            dayByPlace[slot.placeId] === day
                              ? 'border-sky-500 bg-sky-50'
                              : 'border-slate-200'
                          }`}
                        >
                          <Text
                            className={`text-xs font-bold ${
                              dayByPlace[slot.placeId] === day ? 'text-sky-600' : 'text-slate-500'
                            }`}
                          >
                            {t('routeCreateImport.dayChip', { day })}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <View className="px-6 pb-8">
          <TouchableOpacity
            onPress={onConfirmImport}
            disabled={checked.size === 0}
            className={`py-4 rounded-2xl items-center flex-row justify-center gap-2 ${
              checked.size > 0 ? 'bg-sky-500' : 'bg-slate-200'
            }`}
            activeOpacity={0.9}
          >
            <Download size={18} color={checked.size > 0 ? '#fff' : '#94a3b8'} />
            <Text className={`font-bold text-base ${checked.size > 0 ? 'text-white' : 'text-slate-400'}`}>
              {t('routeCreateImport.importSelected', { count: checked.size })}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">{t('routeCreateImport.badge')}</Text>
          <Text className="text-xl font-bold text-slate-800">{t('routeCreateImport.headerTitle')}</Text>
        </View>
      </View>

      <Text className="text-xs text-slate-400 px-6 mb-4">{t('routeCreateImport.hint')}</Text>

      {items.length > 0 && (
        <View className="mx-6 mb-4 p-3 bg-sky-50 rounded-2xl">
          <Text className="text-xs font-bold text-sky-700 mb-2">
            {t('routeCreateImport.importedCount', { count: items.length })}
          </Text>
          {items.map((i) => (
            <View key={i.placeId} className="flex-row items-center justify-between py-1">
              <Text className="text-sm text-sky-800 flex-1" numberOfLines={1}>
                {i.placeName} · {t('routeCreateImport.dayChip', { day: i.dayNumber })}
              </Text>
              <TouchableOpacity onPress={() => removeItem(i.placeId)}>
                <Text className="text-xs text-rose-500 font-bold ml-2">{t('routeCreateImport.removeButton')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {loadingRoutes ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#0ea5e9" /></View>
      ) : routes.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Users2 size={32} color="#cbd5e1" />
          <Text className="text-slate-400 text-sm mt-3 text-center">{t('routeCreateImport.emptyState')}</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 24 }}>
          {routes.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => onOpenRoute(r)}
              className="flex-row items-center justify-between border border-slate-100 rounded-2xl px-4 py-4 mb-3"
              activeOpacity={0.8}
            >
              <View className="flex-1 mr-2">
                <Text className="font-bold text-slate-800 text-sm" numberOfLines={1}>{r.title}</Text>
                <Text className="text-xs text-slate-400 mt-1">
                  {t('routeCreateImport.savedCount', { count: r.saveCount })}
                </Text>
              </View>
              <ChevronRight size={18} color="#94a3b8" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View className="px-6 pb-8">
        <TouchableOpacity onPress={goNext} className="bg-sky-500 py-4 rounded-2xl items-center" activeOpacity={0.9}>
          <Text className="text-white font-bold text-base">
            {items.length > 0 ? t('routeCreateImport.nextButton') : t('routeCreateImport.skipButton')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

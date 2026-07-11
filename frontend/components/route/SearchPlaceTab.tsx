import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { searchPlaces, resolveExternalPlace } from '@/lib/api/places';
import { useImportedSlotsStore } from '@/stores/useImportedSlotsStore';
import { DayPickerConfirm } from '@/components/route/DayPickerConfirm';
import type { KakaoPlaceResult } from '@/lib/api/accommodations';

interface SearchPlaceTabProps {
  dayCount: number;
}

// "직접 장소 추가" — 카카오 검색 → day 지정 → 그 자리에서 find-or-create로 확정해
// useImportedSlotsStore에 합류시킨다("공유 루트에서 가져오기"와 동일 스토어/동일 shape).
export function SearchPlaceTab({ dayCount }: SearchPlaceTabProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<KakaoPlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<KakaoPlaceResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const addSlot = useImportedSlotsStore((s) => s.addSlot);

  useEffect(() => {
    if (!keyword.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchPlaces(keyword.trim());
      setResults(found);
      setSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [keyword]);

  const onPickResult = (result: KakaoPlaceResult) => {
    setPending(result);
    setKeyword('');
    setResults([]);
  };

  const onConfirmDay = async (day: number) => {
    if (!pending || resolving) return;
    setResolving(true);
    try {
      const { placeId } = await resolveExternalPlace({
        name: pending.name,
        address: pending.address,
        lat: pending.lat,
        lng: pending.lng,
        source: 'kakao',
      });
      addSlot({ placeId, placeName: pending.name, dayNumber: day });
      setPending(null);
    } catch {
      Alert.alert(t('routeCreateImport.searchAddFailedTitle'), t('routeCreateImport.searchAddFailedBody'));
    } finally {
      setResolving(false);
    }
  };

  if (pending) {
    return (
      <DayPickerConfirm
        name={pending.name}
        address={pending.address}
        dayCount={dayCount}
        loading={resolving}
        onConfirmDay={onConfirmDay}
        onCancel={() => setPending(null)}
      />
    );
  }

  return (
    <View className="flex-1 px-6">
      <View className="flex-row items-center bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 mb-3">
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder={t('routeCreateImport.searchPlaceholder')}
          className="flex-1 py-3 px-2 text-sm text-slate-700"
        />
        {searching && <ActivityIndicator size="small" />}
      </View>

      {keyword.trim().length > 0 && !searching && results.length === 0 && (
        <Text className="text-xs text-slate-400 mb-3">{t('routeCreateStep4.noSearchResults')}</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item, i) => `${item.name}-${i}`}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => onPickResult(item)}
            className="px-4 py-3 border-b border-slate-100"
          >
            <Text className="font-semibold text-sm text-slate-700">{item.name}</Text>
            {item.address && (
              <Text className="text-xs text-slate-400 mt-0.5" numberOfLines={1}>{item.address}</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

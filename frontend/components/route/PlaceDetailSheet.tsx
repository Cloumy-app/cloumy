import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Linking, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Clock, Gem, Navigation } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { getPlaceDetail } from '@/lib/api/routes';

interface PlaceDetailSheetProps {
  placeId: string | null;
  onClose: () => void;
}

async function openGoogleMaps(lat: number, lng: number) {
  const appUrl = Platform.select({
    ios: `comgooglemaps://?q=${lat},${lng}&zoom=15`,
    android: `geo:${lat},${lng}?q=${lat},${lng}`,
  });
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  if (appUrl) {
    const canOpen = await Linking.canOpenURL(appUrl);
    if (canOpen) {
      await Linking.openURL(appUrl);
      return;
    }
  }
  await Linking.openURL(webUrl);
}

export function PlaceDetailSheet({ placeId, onClose }: PlaceDetailSheetProps) {
  const { t } = useTranslation();
  const { data: place, isLoading } = useQuery({
    queryKey: ['place-detail', placeId],
    queryFn: () => getPlaceDetail(placeId!),
    enabled: !!placeId,
    staleTime: 1000 * 60 * 10,
  });

  if (!placeId) return null;

  return (
    <Modal
      visible={!!placeId}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* 뒷배경 딤처리 */}
      <TouchableOpacity
        className="flex-1 bg-black/40"
        activeOpacity={1}
        onPress={onClose}
      />

      {/* 바텀 시트 */}
      <View className="bg-white rounded-t-3xl px-6 pt-4 pb-10">
        {/* 핸들 + 닫기 */}
        <View className="items-center mb-2">
          <View className="w-10 h-1 rounded-full bg-slate-200" />
        </View>
        <TouchableOpacity
          onPress={onClose}
          className="absolute top-4 right-6 w-8 h-8 items-center justify-center rounded-full bg-slate-100"
        >
          <X size={16} color="#475569" />
        </TouchableOpacity>

        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator color="#0ea5e9" />
            <Text className="text-slate-400 text-sm mt-3">{t('placeDetail.loading')}</Text>
          </View>
        ) : place ? (
          <View className="mt-2">
            {/* 장소명 + 히든젬 배지 */}
            <View className="flex-row items-center gap-2 mb-1 flex-wrap">
              <Text className="font-bold text-xl text-slate-800 flex-shrink">{place.name}</Text>
              {place.isHiddenGem && (
                <View className="flex-row items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <Gem size={11} color="#d97706" />
                  <Text className="text-amber-600 text-[10px] font-bold">{t('placeDetail.hiddenGemBadge')}</Text>
                </View>
              )}
            </View>

            {/* 주소 */}
            {place.address && (
              <View className="flex-row items-start gap-1.5 mt-1 mb-4">
                <MapPin size={13} color="#94a3b8" style={{ marginTop: 2 }} />
                <Text className="text-slate-500 text-sm flex-1">{place.address}</Text>
              </View>
            )}

            {/* 체류시간 */}
            {place.avgDurationMinutes && (
              <View className="flex-row items-center gap-2 bg-slate-50 rounded-2xl px-4 py-3 mb-5">
                <Clock size={16} color="#0ea5e9" />
                <Text className="text-slate-700 font-medium text-sm">
                  {t('placeDetail.avgDurationLabel')}{' '}
                  <Text className="font-bold text-sky-600">
                    {t('placeDetail.avgDurationValue', { minutes: place.avgDurationMinutes })}
                  </Text>
                </Text>
              </View>
            )}

            {/* 구글 지도 딥링크 버튼 */}
            <TouchableOpacity
              onPress={() => openGoogleMaps(place.lat, place.lng)}
              className="flex-row items-center justify-center gap-2 bg-blue-500 rounded-2xl py-4"
              activeOpacity={0.85}
            >
              <Navigation size={18} color="#ffffff" />
              <Text className="font-bold text-white text-base">{t('placeDetail.openInGoogleMaps')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="items-center py-12">
            <Text className="text-slate-400 text-sm">{t('placeDetail.notFound')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

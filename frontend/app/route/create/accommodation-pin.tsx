import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, MapPin } from 'lucide-react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { reverseGeocode } from '@/lib/api/accommodations';
import { useAccommodationPinStore } from '@/stores/useAccommodationPinStore';

// 지도 초기 중심 — step-1 CITIES와 동일한 10개 도시 (프론트엔드엔 좌표 소스가 없어 최소 목록만 보관)
const CITY_CENTERS: Record<string, { latitude: number; longitude: number }> = {
  서울: { latitude: 37.5665, longitude: 126.978 },
  부산: { latitude: 35.1796, longitude: 129.0756 },
  제주: { latitude: 33.4996, longitude: 126.5312 },
  경주: { latitude: 35.8562, longitude: 129.2247 },
  강릉: { latitude: 37.7519, longitude: 128.8761 },
  전주: { latitude: 35.8242, longitude: 127.148 },
  여수: { latitude: 34.7604, longitude: 127.6622 },
  속초: { latitude: 38.2070, longitude: 128.5918 },
  춘천: { latitude: 37.8813, longitude: 127.7298 },
  거제: { latitude: 34.8806, longitude: 128.6212 },
};

export default function AccommodationPinPicker() {
  const params = useLocalSearchParams<{ destination: string }>();
  const initial = CITY_CENTERS[params.destination] ?? CITY_CENTERS['서울'];
  const setStorePin = useAccommodationPinStore((s) => s.setPin);
  const existingPin = useAccommodationPinStore((s) => s.pin);

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(
    existingPin ? { latitude: existingPin.lat, longitude: existingPin.lng } : null,
  );
  const [address, setAddress] = useState<string | null>(existingPin?.address ?? null);
  const [loadingAddress, setLoadingAddress] = useState(false);

  const initialRegion: Region = { ...initial, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  const onMapPress = async (coordinate: { latitude: number; longitude: number }) => {
    setPin(coordinate);
    setAddress(null);
    setLoadingAddress(true);
    try {
      const result = await reverseGeocode(coordinate.latitude, coordinate.longitude);
      setAddress(result); // 실패해도 null — 사용자가 이름은 직접 입력하므로 크래시 없음
    } finally {
      setLoadingAddress(false);
    }
  };

  const onConfirm = () => {
    if (!pin) return;
    setStorePin({ lat: pin.latitude, lng: pin.longitude, address });
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800">숙소 위치 선택</Text>
      </View>

      <MapView
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        onPress={(e) => onMapPress(e.nativeEvent.coordinate)}
      >
        {pin && <Marker coordinate={pin} />}
      </MapView>

      <View className="px-6 pt-4 pb-8 border-t border-slate-100">
        <View className="flex-row items-center gap-2 mb-4 min-h-[20px]">
          <MapPin size={16} color="#0ea5e9" />
          {loadingAddress ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text className="text-sm text-slate-600 flex-1" numberOfLines={2}>
              {pin ? (address ?? '주소를 찾지 못했어요 — 숙소 이름은 직접 입력해주세요') : '지도를 탭해서 숙소 위치를 선택하세요'}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onConfirm}
          disabled={!pin}
          className={`py-4 rounded-2xl items-center ${pin ? 'bg-sky-500' : 'bg-slate-200'}`}
          activeOpacity={0.9}
        >
          <Text className={`font-bold text-base ${pin ? 'text-white' : 'text-slate-400'}`}>이 위치로 선택</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

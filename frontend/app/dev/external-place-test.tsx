import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { resolveExternalPlace } from '@/lib/api/places';
import { devLogin } from '@/lib/api/auth';
import { useAuthStore } from '@/stores/useAuthStore';

type Source = 'manual' | 'kakao' | 'event';
const SOURCES: Source[] = ['manual', 'kakao', 'event'];

export default function ExternalPlaceTestScreen() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [source, setSource] = useState<Source>('manual');
  const [resultPlaceId, setResultPlaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { setTokens, setUser } = useAuthStore();

  const onSubmit = async () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!name.trim() || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      Alert.alert('입력 확인', '이름과 위도/경도(숫자)를 채워주세요');
      return;
    }

    setSubmitting(true);
    try {
      if (__DEV__) {
        const data = await devLogin();
        setTokens(data.accessToken, data.refreshToken);
        setUser(data.user);
      }
      const res = await resolveExternalPlace({
        name: name.trim(),
        address: address.trim() || null,
        lat: latNum,
        lng: lngNum,
        source,
      });
      setResultPlaceId(res.placeId);
    } catch (e) {
      Alert.alert('요청 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-slate-800">외부 장소 테스트 (dev)</Text>
      </View>

      <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="이름"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="주소 (선택)"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={lat}
          onChangeText={setLat}
          placeholder="위도 (예: 37.5)"
          keyboardType="numeric"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />
        <TextInput
          value={lng}
          onChangeText={setLng}
          placeholder="경도 (예: 127.0)"
          keyboardType="numeric"
          className="border-2 border-slate-200 rounded-xl px-4 py-3 mb-3 text-sm"
        />

        <View className="flex-row gap-2 mb-6">
          {SOURCES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSource(s)}
              className={`px-4 py-2 rounded-full border-2 ${source === s ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`}
            >
              <Text className={`text-sm font-semibold ${source === s ? 'text-sky-600' : 'text-slate-500'}`}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={onSubmit}
          disabled={submitting}
          className="bg-sky-500 py-4 rounded-2xl items-center mb-6"
        >
          <Text className="text-white font-bold text-base">{submitting ? '요청 중...' : '전송'}</Text>
        </TouchableOpacity>

        {resultPlaceId && (
          <View className="border-2 border-sky-200 bg-sky-50 rounded-2xl px-4 py-4">
            <Text className="text-xs text-sky-500 font-bold mb-1">placeId</Text>
            <Text className="text-sm text-sky-700" selectable>{resultPlaceId}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

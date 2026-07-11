import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, MapPin, Bookmark } from 'lucide-react-native';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { getPublicRouteSlots, cloneRoute } from '@/lib/api/routes';
import type { SlotWithCoords } from '@/types';

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

export default function CommunityRoutePreviewScreen() {
  const { t } = useTranslation();
  const { routeId, title, destination, nights, saveCount } = useLocalSearchParams<{
    routeId: string;
    title: string;
    destination: string;
    nights: string;
    saveCount: string;
  }>();
  const nightsNum = Number(nights ?? 0);

  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<SlotWithCoords[]>([]);
  const [selectedDay, setSelectedDay] = useState(1);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneStartDate, setCloneStartDate] = useState(new Date());
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getPublicRouteSlots(routeId);
        if (cancelled) return;
        setSlots(data);
        setSelectedDay(data[0]?.dayNumber ?? 1);
      } catch {
        if (!cancelled) {
          Alert.alert(t('communityPreview.notAvailableTitle'), t('communityPreview.notAvailableBody'));
          router.back();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const days = [...new Set(slots.map((s) => s.dayNumber))].sort((a, b) => a - b);
  const daySlots = slots.filter((s) => s.dayNumber === selectedDay);

  const onConfirmClone = async () => {
    if (cloning) return;
    setCloning(true);
    try {
      await cloneRoute(routeId, toDateStr(cloneStartDate));
      setShowCloneModal(false);
      router.replace('/(tabs)/routes');
    } catch {
      Alert.alert(t('communityPreview.cloneFailedTitle'), t('communityPreview.cloneFailedBody'));
    } finally {
      setCloning(false);
    }
  };

  const goToSelectiveImport = () => {
    router.push({
      pathname: '/route/create/step-1',
      params: { prefillDestination: destination, sourceRouteId: routeId, sourceRouteTitle: title },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xl font-bold text-slate-800" numberOfLines={1}>{title}</Text>
          <View className="flex-row items-center gap-3 mt-1">
            <View className="flex-row items-center gap-1">
              <MapPin size={12} color="#94a3b8" />
              <Text className="text-xs text-slate-400">{destination}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Bookmark size={12} color="#94a3b8" />
              <Text className="text-xs text-slate-400">{saveCount}</Text>
            </View>
          </View>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-6 py-2" contentContainerStyle={{ gap: 8 }}>
            {days.map((day) => (
              <TouchableOpacity
                key={day}
                onPress={() => setSelectedDay(day)}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  borderRadius: 16,
                  backgroundColor: selectedDay === day ? '#0ea5e9' : '#f1f5f9',
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 14, color: selectedDay === day ? '#ffffff' : '#475569' }}>
                  {t('routeResult.dayTabLabel', { day })}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
            {daySlots.map((slot, i) => (
              <View key={slot.id} className="border-2 border-slate-100 rounded-2xl px-4 py-3 mb-3 flex-row items-center">
                <View className="w-6 h-6 rounded-full bg-sky-500 items-center justify-center mr-3">
                  <Text className="text-white text-xs font-bold">{i + 1}</Text>
                </View>
                <Text className="font-bold text-slate-800 text-sm flex-1">{slot.placeName}</Text>
              </View>
            ))}
            <View className="h-4" />
          </ScrollView>
        </>
      )}

      <View className="px-6 pb-8 gap-2">
        <TouchableOpacity
          onPress={() => {
            setCloneStartDate(new Date());
            setShowCloneModal(true);
          }}
          className="bg-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          <Text className="text-white font-bold text-base">{t('communityPreview.importAllButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={goToSelectiveImport}
          className="border-2 border-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          <Text className="text-sky-600 font-bold text-base">{t('communityPreview.importSelectedButton')}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showCloneModal} transparent animationType="slide">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setShowCloneModal(false)} />
        <View className="bg-white rounded-t-3xl px-6 pt-5 pb-10">
          <View className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
          <Text className="text-base font-bold text-slate-800 mb-1">{t('communityPreview.cloneModalTitle')}</Text>
          <Text className="text-xs text-slate-400 mb-3">
            {t('communityPreview.cloneModalNightsHint', { nights: nightsNum })}
          </Text>
          <DateTimePicker
            value={cloneStartDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onValueChange={(_, date) => {
              if (date) setCloneStartDate(date);
            }}
          />
          <TouchableOpacity
            onPress={onConfirmClone}
            disabled={cloning}
            className="bg-sky-500 py-4 rounded-2xl items-center mt-4"
          >
            {cloning ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-bold text-base">{t('communityPreview.cloneConfirmButton')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

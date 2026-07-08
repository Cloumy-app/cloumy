import { useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import type { Accommodation, SlotWithCoords } from '@/types';

const DAY_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

interface TripMapProps {
  slots: SlotWithCoords[];
  accommodations?: Accommodation[];
  selectedDay: number;
  height?: number;
  focusedSlotId?: string;
  onSlotPress?: (slotId: string) => void;
}

export function TripMap({ slots, accommodations = [], selectedDay, height = 300, focusedSlotId, onSlotPress }: TripMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);

  const days = [...new Set(slots.map((s) => s.dayNumber))].sort();

  useEffect(() => {
    if (!focusedSlotId) return;
    const target = slots.find((s) => s.id === focusedSlotId);
    if (!target || target.lat === 0) return;
    mapRef.current?.animateToRegion(
      { latitude: target.lat, longitude: target.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
      400,
    );
  }, [focusedSlotId]);

  const validSlots = slots.filter((s) => s.lat !== 0 && s.lng !== 0);

  // 일차별 정렬 순서 기준으로 표시 번호 계산 (orderIndex 값이 아닌 실제 위치)
  const displayRank = new Map<string, number>();
  days.forEach((day) => {
    validSlots
      .filter((s) => s.dayNumber === day)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((s, i) => displayRank.set(s.id, i + 1));
  });

  if (validSlots.length === 0) {
    return (
      <View
        className="bg-slate-100 items-center justify-center"
        style={{ height }}
      >
        <Text className="text-slate-400 text-sm">{t('tripMap.preparing')}</Text>
      </View>
    );
  }

  const firstSlot = validSlots[0];
  const initialRegion: Region = {
    latitude: firstSlot.lat,
    longitude: firstSlot.lng,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };

  return (
    <MapView
      ref={mapRef}
      style={{ height }}
      initialRegion={initialRegion}
      showsUserLocation={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {/* Day별 경로선 */}
      {days.map((day) => {
        const daySlots = validSlots
          .filter((s) => s.dayNumber === day)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        if (daySlots.length < 2) return null;
        const color = DAY_COLORS[(day - 1) % DAY_COLORS.length];
        return (
          <Polyline
            key={`poly-${day}-${daySlots.map(s => s.id).join('-')}`}
            coordinates={daySlots.map((s) => ({ latitude: s.lat, longitude: s.lng }))}
            strokeColor={color}
            strokeWidth={day === selectedDay ? 3 : 1.5}
            lineDashPattern={day === selectedDay ? undefined : [6, 4]}
          />
        );
      })}

      {/* 슬롯 마커 */}
      {validSlots.map((slot) => {
        const color = DAY_COLORS[(slot.dayNumber - 1) % DAY_COLORS.length];
        const isActive = slot.dayNumber === selectedDay;
        const isFocused = slot.id === focusedSlotId;
        const size = isFocused ? 36 : isActive ? 28 : 22;
        const number = displayRank.get(slot.id) ?? 0;
        return (
          <Marker
            key={slot.id}
            coordinate={{ latitude: slot.lat, longitude: slot.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={slot.placeName}
            opacity={isActive ? 1 : 0.45}
            onPress={() => onSlotPress?.(slot.id)}
          >
            <View
              className="rounded-full items-center justify-center"
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                borderWidth: isFocused ? 3 : 2,
                borderColor: '#ffffff',
                shadowColor: isFocused ? color : 'transparent',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isFocused ? 0.6 : 0,
                shadowRadius: 4,
                elevation: isFocused ? 6 : 0,
              }}
            >
              <Text className="text-white font-black" style={{ fontSize: isFocused ? 13 : isActive ? 11 : 9 }}>
                {number}
              </Text>
            </View>
          </Marker>
        );
      })}

      {/* 숙소 마커 — day에 종속되지 않으므로 DAY_COLORS 안 쓰고 고정 색상, 슬롯 마커에 안 가리게 zIndex 우선 */}
      {accommodations
        .filter((a) => a.lat !== 0 && a.lng !== 0)
        .map((acc) => (
          <Marker
            key={acc.id}
            coordinate={{ latitude: acc.lat, longitude: acc.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={acc.name}
            zIndex={999}
          >
            <View
              className="rounded-full items-center justify-center bg-indigo-600"
              style={{ width: 30, height: 30, borderWidth: 2, borderColor: '#ffffff' }}
            >
              <Text style={{ fontSize: 14 }}>🏨</Text>
            </View>
          </Marker>
        ))}
    </MapView>
  );
}

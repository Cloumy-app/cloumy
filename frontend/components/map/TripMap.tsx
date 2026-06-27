import { useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import MapView, { Marker, Polyline, type MapViewMethods, type Region } from 'react-native-maps';
import type { SlotWithCoords } from '@/types';

const DAY_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

interface TripMapProps {
  slots: SlotWithCoords[];
  selectedDay: number;
  height?: number;
  focusedSlotId?: string;
}

export function TripMap({ slots, selectedDay, height = 300, focusedSlotId }: TripMapProps) {
  const mapRef = useRef<MapViewMethods>(null);

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

  if (validSlots.length === 0) {
    return (
      <View
        className="bg-slate-100 items-center justify-center"
        style={{ height }}
      >
        <Text className="text-slate-400 text-sm">지도 데이터 준비 중...</Text>
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
            key={`poly-${day}`}
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
        return (
          <Marker
            key={slot.id}
            coordinate={{ latitude: slot.lat, longitude: slot.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={slot.placeName}
            opacity={isActive ? 1 : 0.45}
          >
            <View
              className="rounded-full items-center justify-center"
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                borderWidth: isFocused ? 3 : 2,
                borderColor: isFocused ? '#ffffff' : '#ffffff',
                shadowColor: isFocused ? color : 'transparent',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isFocused ? 0.6 : 0,
                shadowRadius: 4,
                elevation: isFocused ? 6 : 0,
              }}
            >
              <Text className="text-white font-black" style={{ fontSize: isFocused ? 13 : isActive ? 11 : 9 }}>
                {slot.orderIndex + 1}
              </Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

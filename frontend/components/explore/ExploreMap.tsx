import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import type { PlaceBrowseItem } from '@/types';

interface ExploreMapProps {
  places: PlaceBrowseItem[];
  focusedPlaceId: string | null;
  onMarkerPress: (placeId: string) => void;
  height?: number;
}

export function ExploreMap({ places, focusedPlaceId, onMarkerPress, height = 220 }: ExploreMapProps) {
  const mapRef = useRef<MapView>(null);

  const validPlaces = places.filter((p) => p.lat !== 0 || p.lng !== 0);
  const placeIdsKey = validPlaces.map((p) => p.id).join(',');

  // 리스트(도시/테마/북마크 모드) 변경 시 전체 마커가 화면에 들어오도록 범위 재조정
  useEffect(() => {
    if (validPlaces.length === 0) return;
    if (validPlaces.length === 1) {
      mapRef.current?.animateToRegion(
        { latitude: validPlaces[0].lat, longitude: validPlaces[0].lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        400,
      );
      return;
    }
    mapRef.current?.fitToCoordinates(
      validPlaces.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true },
    );
  }, [placeIdsKey]);

  // 리스트 카드 선택 시 해당 장소로 포커스 이동
  useEffect(() => {
    if (!focusedPlaceId) return;
    const target = validPlaces.find((p) => p.id === focusedPlaceId);
    if (!target) return;
    mapRef.current?.animateToRegion(
      { latitude: target.lat, longitude: target.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
  }, [focusedPlaceId]);

  if (validPlaces.length === 0) {
    return <View className="bg-slate-100" style={{ height }} />;
  }

  const initialRegion = {
    latitude: validPlaces[0].lat,
    longitude: validPlaces[0].lng,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
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
      {validPlaces.map((place) => (
        <Marker
          key={place.id}
          coordinate={{ latitude: place.lat, longitude: place.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={place.name}
          onPress={() => onMarkerPress(place.id)}
        >
          <View
            className="rounded-full items-center justify-center"
            style={{
              width: 20,
              height: 20,
              backgroundColor: place.isBookmarked ? '#f43f5e' : '#0ea5e9',
              borderWidth: 2,
              borderColor: '#ffffff',
            }}
          />
        </Marker>
      ))}
    </MapView>
  );
}

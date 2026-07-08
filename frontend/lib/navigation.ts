import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

// 도보 내비 — 목적지만 넘기면 출발지는 기기 GPS 위치로 자동 추정(Google Maps 기본 동작)
export async function openWalkNavigation(lat: number, lng: number) {
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

// 대중교통 내비 — 1순위 Naver Map(한국 대중교통 정확도 최우선), 2순위 Google Maps 대중교통 모드.
// Naver Map은 방한 외국인 관광객 사이 설치율이 낮아 완전한 fallback이 필요한데, Naver 웹 지도는
// 경로 URL 포맷이 버전별로 바뀌어 신뢰도가 낮으므로 검색 페이지 대신 설치율이 훨씬 높은 Google Maps
// 대중교통 모드로 대체한다 — 정확도는 Naver보다 낮지만(도보 참고), 실제 경로 화면을 보여줄 수 있음.
// appname은 Naver 사전 등록 없이 쓸 수 있는 자유 식별자(내비 화면의 "앱으로 돌아가기" 표시용).
export async function openTransitNavigation(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number; name: string },
) {
  const naverAppUrl =
    `nmap://route/public?slat=${origin.lat}&slng=${origin.lng}` +
    `&dlat=${destination.lat}&dlng=${destination.lng}&dname=${encodeURIComponent(destination.name)}` +
    `&appname=com.anonymous.cloumy`;

  if (await Linking.canOpenURL(naverAppUrl)) {
    await Linking.openURL(naverAppUrl);
    return;
  }

  const googleAppUrl = Platform.select({
    ios: `comgooglemaps://?saddr=${origin.lat},${origin.lng}&daddr=${destination.lat},${destination.lng}&directionsmode=transit`,
    android: `google.navigation:q=${destination.lat},${destination.lng}&mode=transit`,
  });
  const googleWebUrl =
    `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}&travelmode=transit`;

  if (googleAppUrl && (await Linking.canOpenURL(googleAppUrl))) {
    await Linking.openURL(googleAppUrl);
    return;
  }
  await Linking.openURL(googleWebUrl);
}

// 위치 권한이 없거나 GPS 획득에 실패하면 fallback 좌표로 대체하고, 거부 시에만 안내
// 알림을 띄운다. transit 내비 출발지 전용 — walk는 외부 지도 앱이 자체적으로 기기
// 위치를 추정하므로 이 함수를 쓰지 않는다.
export async function getCurrentLocationOrFallback(
  fallback: { lat: number; lng: number },
): Promise<{ lat: number; lng: number }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        '위치 권한이 필요해요',
        '위치 권한을 허용하면 실제 내 위치 기준으로 더 정확한 길찾기를 받을 수 있어요.',
      );
      return fallback;
    }
    const position = await Location.getCurrentPositionAsync({});
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return fallback;
  }
}

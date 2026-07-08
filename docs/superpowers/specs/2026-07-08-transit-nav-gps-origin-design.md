# 대중교통 내비 출발지에 실제 GPS 위치 사용 설계

## 배경

`SlotCard.tsx`의 `handleNavigate`는 대중교통(transit) 내비 버튼을 눌렀을 때 출발지로 **이전 슬롯의 저장된 좌표**(`apiSlot.lat/lng`)를 그대로 쓰고 있다. 이건 "사용자가 정확히 그 장소에 서 있다"는 가정인데, 실제로는 딴 데로 새거나 살짝 벗어난 위치에서 다음 장소로 이동하려 할 수 있어 부정확하다. 실제 기기 GPS 위치를 출발지로 쓰면 더 정확한 경로 안내가 가능하다.

앱에 위치 권한/GPS 관련 코드가 지금까지 전혀 없다(`expo-location` 미설치, `TripMap.tsx`의 `showsUserLocation={false}`) — 이번이 최초 도입이다.

## 범위

**포함**: transit 내비(`openTransitNavigation`)의 출발지만 GPS로 대체. `expo-location` 신규 도입, 권한 요청 흐름, 거부/실패 시 폴백.

**제외**: walk 내비는 그대로 둔다 — Google Maps 앱/웹이 목적지만 받으면 자체적으로 기기 GPS를 출발지로 추정하므로 우리가 직접 GPS를 가져올 필요가 없다. 지도 화면(`TripMap.tsx`)에 파란 점 표시하는 것도 이번 스코프 아님(완전히 별개 기능).

## 핵심 흐름

```
transit 내비 버튼 탭
  → Location.requestForegroundPermissionsAsync()
      승인 안 됨 → Alert 안내("위치 권한을 허용하면 더 정확한 길찾기를 받을 수 있어요")
                 → 이전 슬롯 좌표로 폴백, 내비는 그대로 열림
      승인됨    → Location.getCurrentPositionAsync()로 좌표 획득
                 → 그 좌표를 출발지로 openTransitNavigation 호출
                 (획득 자체가 실패해도 이전 슬롯 좌표로 동일하게 폴백)
```

캐싱 없음 — 탭할 때마다 새로 fetch(사용자가 이동했을 수 있어 매번 최신값이 맞고, 탭 빈도가 낮아 성능 문제 없음).

## 파일별 변경 사항

### `frontend/app.json`
`plugins` 배열에 `expo-location` 추가, iOS 위치 권한 안내 문구 설정:
```json
[
  "expo-location",
  { "locationWhenInUsePermission": "Cloumy가 실제 위치 기준으로 정확한 길찾기를 제공하기 위해 위치 정보를 사용합니다." }
]
```
⚠️ Info.plist 네이티브 설정 변경이라 `npx expo run:ios` 재빌드 필요(JS 리로드로는 반영 안 됨) — 이전 `LSApplicationQueriesSchemes` 건과 동일한 제약.

### `frontend/package.json`
`expo-location` 의존성 추가(`npx expo install expo-location`으로 SDK 56 호환 버전 자동 선택).

### `frontend/lib/navigation.ts`
신규 함수 `getCurrentLocationOrFallback()` 추가:
```ts
import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';

// 위치 권한 없거나 GPS 획득 실패 시 fallback 좌표로 대체. 거부 시에만 안내 알림.
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
```
`openWalkNavigation`/`openTransitNavigation` 자체는 변경 없음(호출부에서 origin만 다르게 넘김).

### `frontend/components/route/SlotCard.tsx`
`handleNavigate`의 transit 분기를 async로 변경:
```ts
// 기존
if (transportToNext === 'transit' && apiSlot) {
  return () => openTransitNavigation({ lat: apiSlot.lat, lng: apiSlot.lng }, nextPlace);
}
```
```ts
// 변경 후
if (transportToNext === 'transit' && apiSlot) {
  return async () => {
    const origin = await getCurrentLocationOrFallback({ lat: apiSlot.lat, lng: apiSlot.lng });
    await openTransitNavigation(origin, nextPlace);
  };
}
```
`import { openTransitNavigation, openWalkNavigation } from '@/lib/navigation';`에 `getCurrentLocationOrFallback` 추가.

`TransportChip`의 `onNavigate?: () => void` prop 타입은 변경 불필요 — TypeScript가 `() => Promise<void>`를 `() => void`에 할당 가능하도록 허용(반환값 무시), `TouchableOpacity`의 `onPress`도 동일 패턴 이미 씀.

## 에러 처리

- 권한 거부: `Alert` 안내 후 이전 슬롯 좌표로 폴백, 내비는 그대로 열림(기능 차단 없음).
- `getCurrentPositionAsync` 타임아웃/실패(예: 시뮬레이터에서 위치 시뮬레이션 꺼짐): `try/catch`로 잡아 동일하게 폴백. 별도 알림 없음(권한은 있는데 일시적으로 못 받아온 경우까지 매번 알림 띄우면 노이즈).
- 신규 실패 시나리오 없음 — 모든 실패 경로가 기존 동작(이전 슬롯 좌표 사용)으로 수렴.

## 검증 방법

```bash
# 1. 프론트 타입체크
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "navigation.ts\|SlotCard"
# → 신규 에러 없음

# 2. 네이티브 재빌드 (Info.plist 변경 반영)
npx expo run:ios

# 3. 수동 검증
# - 앱 최초 실행 후 transit 내비 버튼 탭 → 시스템 위치 권한 다이얼로그 뜨는지
# - 허용 시 실제 기기 위치가 출발지로 쓰이는지 (딥링크 URL의 slat/slng가 이전 슬롯 좌표와 다른지 로그로 확인)
# - 거부 시 안내 Alert 뜨고, 그래도 내비는 이전 슬롯 좌표로 정상 열리는지
# - 설정에서 위치 권한 끈 상태로 재탭 → 동일하게 안내+폴백 확인
```

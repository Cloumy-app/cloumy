@AGENTS.md

# Cloumy Frontend

## 기술 스택
- React Native + Expo SDK 56, Expo Router (파일 기반, app/)
- NativeWind v4 (Tailwind className), TanStack Query, Zustand
- react-native-reanimated v4, react-native-gesture-handler v2
- react-native-maps, react-native-mmkv, react-native-sse

## 폴더 구조
- app/ — Expo Router 라우트 (route/create/step-*.tsx, route/[routeId]/)
- components/route/, components/map/ — 도메인 컴포넌트
- lib/api/ — API 함수 (routes.ts, weather.ts)
- stores/ — Zustand 스토어
- types/ — 공유 타입

## 핵심 패턴
- NativeWind + TouchableOpacity: `className` 대신 `style` prop 사용 (CssInterop 이슈)
- Reanimated v4: `Gesture.Pan()` + `GestureDetector` (`useAnimatedGestureHandler` 미지원)
- 낙관적 업데이트: `setQueryData` → API 호출 → 실패 시 `invalidateQueries`
- 서버 상태: TanStack Query / 클라이언트 상태: Zustand
- 지도 마커 번호: `orderIndex` 값이 아닌 배열 위치(displayRank) 기준으로 계산

## 빌드
```bash
npx expo run:ios  # Expo Go 불가 (mmkv 등 native module)
```

# 대중교통 내비 GPS 출발지 사용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** transit 내비(`openTransitNavigation`) 출발지를 이전 슬롯 좌표 대신 실제 기기 GPS 위치로 대체한다.

**Architecture:** `expo-location`을 신규 도입해 `frontend/lib/navigation.ts`에 `getCurrentLocationOrFallback()` 헬퍼를 추가한다. 이 헬퍼가 권한 요청 → GPS 획득 → 실패 시 폴백까지 전부 캡슐화하고, `SlotCard.tsx`의 `handleNavigate`는 이 결과를 `openTransitNavigation`의 origin으로 넘기기만 하면 된다.

**Tech Stack:** React Native + Expo SDK 56, `expo-location`(신규), TypeScript.

## Global Constraints

- Expo SDK 56 호환 버전으로 설치 — `npx expo install expo-location`으로 자동 선택 (수동 `npm install`로 임의 버전 지정 금지)
- walk 내비(`openWalkNavigation`)는 이번 스코프에서 변경하지 않는다 — 외부 지도 앱이 자체적으로 기기 GPS를 출발지로 추정하므로 우리가 직접 GPS를 가져올 필요 없음
- 권한 거부/GPS 획득 실패 시에도 내비 자체는 항상 열려야 한다(이전 슬롯 좌표로 폴백) — 기능 차단 절대 금지
- 프로젝트에 테스트 러너(jest 등)가 설치돼 있지 않다 — 기존 프론트 태스크들과 동일하게 `npx tsc --noEmit`과 수동 시뮬레이터 검증으로 확인한다(신규 테스트 프레임워크 도입 금지, YAGNI)
- `Info.plist` 관련 네이티브 설정 변경(`app.json`의 `plugins`)은 JS 리로드로 반영되지 않는다 — `npx expo run:ios` 재빌드가 반드시 필요
- **치명적 실패 시나리오(FFE)**: iOS는 `NSLocationWhenInUseUsageDescription` 문구가 Info.plist에 없는 상태로 위치 API를 호출하면 에러 메시지 없이 앱을 강제 종료시킨다. `expo-location`의 config plugin 속성명은 `locationWhenInUsePermission`이 맞다(Expo 공식 문서 "Configurable properties" 확인 완료, 버전 불확실성 해소됨) — Task 3에서 네이티브 재빌드 후 반드시 Info.plist에 이 키가 실제로 들어갔는지 확인하고서 테스트한다.

---

### Task 1: `expo-location` 의존성 설치 + iOS 권한 설정

**Files:**
- Modify: `frontend/package.json` (의존성 추가 — `npx expo install`이 자동 처리)
- Modify: `frontend/app.json:2-16` (`plugins` 배열에 `expo-location` 항목 추가)

**Interfaces:**
- Consumes: 없음(신규 설치)
- Produces: `expo-location` 패키지를 이후 Task에서 `import * as Location from 'expo-location'`로 사용 가능

- [ ] **Step 1: expo-location 설치**

```bash
cd frontend && npx expo install expo-location
```

Expected: `package.json`의 `dependencies`에 `"expo-location": "~<SDK56 호환 버전>"`이 추가됨. 설치 완료 후 버전 확인:

```bash
grep '"expo-location"' package.json
```

Expected: 버전 문자열이 출력됨(빈 결과면 설치 실패).

- [ ] **Step 2: app.json에 위치 권한 플러그인 설정 추가**

`frontend/app.json`의 현재 `plugins` 배열(정확한 현재 내용을 아래에서 확인 후 수정):

```bash
cd frontend && python3 -c "import json; print(json.dumps(json.load(open('app.json'))['expo']['plugins'], indent=2, ensure_ascii=False))"
```

Expected 출력(현재 상태, `react-native-maps`까지만 있음):
```json
[
  "expo-router",
  [
    "react-native-maps",
    {
      "googleMapsApiKey": ""
    }
  ]
]
```

이 배열 끝에 `expo-location` 플러그인 항목을 추가한다. `app.json`을 열어 `"plugins"` 배열을 다음과 같이 수정:

```json
    "plugins": [
      "expo-router",
      [
        "react-native-maps",
        {
          "googleMapsApiKey": ""
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Cloumy가 실제 위치 기준으로 정확한 길찾기를 제공하기 위해 위치 정보를 사용합니다."
        }
      ]
    ],
```

`locationWhenInUsePermission`은 Expo 공식 문서("Configurable properties" 항목)로 확인된 정확한 속성명이다. 다만 프로젝트에 실제 설치되는 버전에서 한 번 더 크로스체크한다:

```bash
find node_modules/expo-location -iname "*plugin*" -maxdepth 2
```

- [ ] **Step 3: 변경 사항 확인**

```bash
python3 -c "import json; d=json.load(open('app.json')); print(json.dumps(d['expo']['plugins'], indent=2, ensure_ascii=False))"
```

Expected: 위 3단계(`expo-router`, `react-native-maps`, `expo-location`) 배열이 정확히 출력됨.

- [ ] **Step 4: 커밋**

```bash
git add frontend/package.json frontend/package-lock.json frontend/app.json
git commit -m "$(cat <<'EOF'
feat: ✨ [Frontend] expo-location 의존성 추가 + iOS 위치 권한 설정

대중교통 내비 출발지를 실제 GPS 위치로 쓰기 위한 선행 작업.
EOF
)"
```

---

### Task 2: `getCurrentLocationOrFallback()` 헬퍼 추가

**Files:**
- Modify: `frontend/lib/navigation.ts` (현재 53줄, 끝에 새 함수 추가)

**Interfaces:**
- Consumes: Task 1에서 설치된 `expo-location`의 `requestForegroundPermissionsAsync()`, `getCurrentPositionAsync()`
- Produces: `export async function getCurrentLocationOrFallback(fallback: { lat: number; lng: number }): Promise<{ lat: number; lng: number }>` — Task 3에서 `SlotCard.tsx`가 이 함수를 import해서 사용

- [ ] **Step 1: 현재 `navigation.ts` 전체 확인**

```bash
cat frontend/lib/navigation.ts
```

Expected: `Linking`, `Platform`만 import된 53줄짜리 파일 — `openWalkNavigation`, `openTransitNavigation` 두 함수만 존재. (아래 Step 2에서 이 파일 끝에 새 함수를 추가한다.)

- [ ] **Step 2: import 문에 `Alert`, `expo-location` 추가**

`frontend/lib/navigation.ts` 최상단 import를 다음과 같이 수정한다.

기존:
```typescript
import { Linking, Platform } from 'react-native';
```

변경 후:
```typescript
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
```

- [ ] **Step 3: `getCurrentLocationOrFallback()` 함수 추가**

파일 끝(`openTransitNavigation` 함수 뒤)에 다음 함수를 추가한다:

```typescript

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
```

- [ ] **Step 4: 타입체크로 검증**

이 프로젝트엔 jest 등 테스트 러너가 없으므로(Global Constraints 참고), 타입체크로 함수 시그니처와 import가 올바른지 확인한다:

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "navigation.ts"
```

Expected: 아무 출력 없음(에러 0건). `expo-location` 타입 정의가 없다는 에러가 나오면 Task 1의 설치가 제대로 안 된 것이니 `npx expo install expo-location`을 다시 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/lib/navigation.ts
git commit -m "$(cat <<'EOF'
feat: ✨ [Frontend] GPS 위치 조회 헬퍼 추가 (getCurrentLocationOrFallback)

위치 권한 요청 → GPS 획득 → 거부/실패 시 fallback 좌표로 대체.
거부 시에만 안내 알림 표시, 기능 자체는 항상 진행됨.
EOF
)"
```

---

### Task 3: `SlotCard.tsx`의 transit 내비에 GPS 출발지 연결

**Files:**
- Modify: `frontend/components/route/SlotCard.tsx:8` (import 추가)
- Modify: `frontend/components/route/SlotCard.tsx:160-170` (`handleNavigate`의 transit 분기)

**Interfaces:**
- Consumes: Task 2에서 만든 `getCurrentLocationOrFallback(fallback: { lat: number; lng: number }): Promise<{ lat: number; lng: number }>`, 기존 `openTransitNavigation(origin, destination)` (변경 없음)
- Produces: 없음(최종 소비 지점 — TransportChip의 `onNavigate` prop이 이 `handleNavigate`를 그대로 받음, 기존 배선 변경 없음)

- [ ] **Step 1: 현재 `handleNavigate` 확인**

```bash
grep -n "handleNavigate" -A 10 frontend/components/route/SlotCard.tsx | head -15
```

Expected:
```typescript
  const handleNavigate = (() => {
    if (!nextPlace) return undefined;
    if (transportToNext === 'walk') {
      return () => openWalkNavigation(nextPlace.lat, nextPlace.lng);
    }
    if (transportToNext === 'transit' && apiSlot) {
      return () => openTransitNavigation({ lat: apiSlot.lat, lng: apiSlot.lng }, nextPlace);
    }
    return undefined;
  })();
```

- [ ] **Step 2: import 문 수정**

기존(`frontend/components/route/SlotCard.tsx:8`):
```typescript
import { openTransitNavigation, openWalkNavigation } from '@/lib/navigation';
```

변경 후:
```typescript
import { getCurrentLocationOrFallback, openTransitNavigation, openWalkNavigation } from '@/lib/navigation';
```

- [ ] **Step 3: transit 분기를 async GPS 조회로 교체**

기존:
```typescript
    if (transportToNext === 'transit' && apiSlot) {
      return () => openTransitNavigation({ lat: apiSlot.lat, lng: apiSlot.lng }, nextPlace);
    }
```

변경 후:
```typescript
    if (transportToNext === 'transit' && apiSlot) {
      return async () => {
        const origin = await getCurrentLocationOrFallback({ lat: apiSlot.lat, lng: apiSlot.lng });
        await openTransitNavigation(origin, nextPlace);
      };
    }
```

(walk 분기는 그대로 둔다 — Global Constraints 참고.)

- [ ] **Step 4: 타입체크로 검증**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -i "SlotCard"
```

Expected: 아무 출력 없음. (`TransportChip`의 `onNavigate?: () => void` 타입에 `() => Promise<void>`를 할당해도 TypeScript는 반환값을 무시 가능한 함수 타입 할당을 허용하므로 별도 타입 변경 불필요 — 에러 발생 시에만 `onNavigate?: () => void | Promise<void>`로 조정.)

- [ ] **Step 5: 네이티브 재빌드 (Info.plist 반영)**

Task 1의 `app.json` 변경(위치 권한 plugin)이 반영되려면 재빌드가 필요하다:

```bash
cd frontend && npx expo run:ios
```

Expected: 빌드 성공, 시뮬레이터에서 앱 정상 실행.

**⚠️ FFE 치명적 실패 시나리오 예방 확인**: Info.plist에 권한 문구가 없으면 iOS가 위치 API 호출 시 에러 메시지 없이 앱을 강제 종료시킨다. 재빌드 후 반드시 아래로 실제 반영 여부를 먼저 확인한다:

```bash
grep -A2 "NSLocationWhenInUseUsageDescription" ios/Cloumy/Info.plist
```

Expected: Task 1에서 설정한 한국어 문구가 그대로 출력됨. 출력이 없으면 Step 6 진행 전에 원인을 먼저 해결한다(Task 1의 plugin 설정 또는 재빌드 자체가 잘못됐을 가능성).

- [ ] **Step 6: 수동 검증 (시뮬레이터/실기기)**

1. 대중교통(transit) 구간이 있는 루트를 열고 이동수단 배지 옆 내비 버튼을 탭한다.
2. **최초 탭**: 시스템 위치 권한 다이얼로그가 뜨는지 확인.
3. **허용** 선택 → Naver/Google 내비가 정상적으로 열리는지 확인. (선택사항: `openTransitNavigation` 호출 직전에 `console.log(origin)`을 임시로 추가해 origin 좌표가 이전 슬롯 좌표와 다른지, 즉 실제 기기 위치인지 확인 후 로그 제거.)
4. 설정 앱에서 Cloumy의 위치 권한을 **거부**로 변경 → 같은 버튼 재탭 → **안내 Alert**("위치 권한이 필요해요")가 뜨고, 그 후 내비는 이전 슬롯 좌표로 정상 열리는지 확인(차단되지 않아야 함).

- [ ] **Step 7: 커밋**

```bash
git add frontend/components/route/SlotCard.tsx
git commit -m "$(cat <<'EOF'
feat: ✨ [Frontend] 대중교통 내비 출발지에 실제 GPS 위치 사용

이전 슬롯 좌표 대신 getCurrentLocationOrFallback()으로 조회한
기기 GPS 위치를 transit 내비 출발지로 사용. 권한 거부/GPS 획득
실패 시 이전 슬롯 좌표로 폴백(내비 자체는 항상 열림).

Closes #106
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- "transit 내비 출발지를 GPS로 대체" → Task 3
- "expo-location 신규 도입" → Task 1
- "권한 요청 → 승인 시 GPS, 거부 시 안내+폴백" → Task 2
- "walk는 변경 없음" → Global Constraints + Task 3 Step 3에서 명시적으로 walk 분기 미변경
- "캐싱 없음(매번 fetch)" → Task 2의 함수가 매 호출마다 새로 `getCurrentPositionAsync()` 호출, 별도 캐싱 레이어 없음 — 설계대로

**Placeholder scan:** 없음 — 모든 스텝에 실제 코드/명령어 포함.

**Type consistency:** `getCurrentLocationOrFallback(fallback: { lat: number; lng: number }): Promise<{ lat: number; lng: number }>` — Task 2에서 정의한 시그니처와 Task 3에서 호출하는 방식(`await getCurrentLocationOrFallback({ lat: apiSlot.lat, lng: apiSlot.lng })`)이 일치함.

# iOS 실기기 개발 빌드 가이드

## 왜 Expo Go로 안 되는가

Cloumy는 `react-native-mmkv`, `react-native-maps`, `expo-location` 같은 네이티브 모듈을 쓴다. 이런 모듈은 앱스토어의 Expo Go 앱에 포함돼 있지 않아서, SDK 버전을 맞춰도 Expo Go로는 실행이 안 된다(`frontend/CLAUDE.md` 참고). 시뮬레이터·실기기 둘 다 커스텀 dev client(`npx expo run:ios`)를 직접 빌드해서 설치하는 방법만 가능하다.

## 최초 1회 설정 (실기기 전용)

시뮬레이터는 필요 없고, 실제 iPhone에서 처음 실행할 때만 아래를 순서대로 한다.

1. **Xcode 서명 설정**
   ```bash
   open ios/Cloumy.xcworkspace
   ```
   `.xcodeproj`가 아니라 `.xcworkspace`로 열어야 한다. 왼쪽 네비게이터에서 Cloumy 프로젝트 → TARGETS의 Cloumy → **Signing & Capabilities** 탭 → **Team**에서 Apple ID 선택(무료 계정으로 충분, 유료 Apple Developer Program 불필요). 목록에 Apple ID가 없으면 Xcode → Settings(⌘,) → Accounts → `+`로 로그인.

2. **iPhone 개발자 모드 활성화**
   설정 → 개인정보 보호 및 보안 → 개발자 모드. 이 토글은 **최초로 `npx expo run:ios --device`를 시도한 뒤에야** 설정에 나타난다(먼저 찾아보면 없음 — 순서가 중요). 나타나면 켜기 → 재부팅 → 재부팅 후 뜨는 확인창에서 한 번 더 켜기 확인.
   **한 번 켜두면 재부팅해도 계속 유지되는 설정**이라 매번 다시 켤 필요는 없다. 단, 임의로 꺼두면(보안 경고 때문에 끄는 경우 등) 다시 켜야 개발 빌드가 실행된다 — 개발자 모드가 꺼진 상태에서는 서명되지 않은(스토어 미배포) 앱 실행 자체가 iOS에서 차단된다.

3. **신뢰되지 않는 개발자 허용**
   최초 설치 후 앱 실행 시 "신뢰하지 않는 개발자" 팝업이 뜨면: 설정 → 일반 → **VPN 및 기기 관리** → 해당 Apple ID 개발자 프로필 탭 → 신뢰 → 확인창에서 한 번 더 신뢰.

4. **백엔드 주소를 `localhost`에서 맥 LAN IP로 변경**
   시뮬레이터는 `localhost`가 맥 자신을 가리키지만, 실기기는 아이폰 자기 자신을 가리켜서 맥의 Spring 서버(`localhost:8080`)에 절대 도달할 수 없다. 맥의 LAN IP를 확인:
   ```bash
   ipconfig getifaddr en0
   ```
   `frontend/.env`에서 수정:
   ```
   EXPO_PUBLIC_API_BASE_URL=http://<위에서 확인한 IP>:8080
   ```
   Spring 서버(Docker)는 기본적으로 `0.0.0.0:8080`으로 열려 있어 별도 백엔드 설정 변경은 필요 없다.

5. **같은 Wi-Fi 확인**
   맥과 아이폰이 같은 Wi-Fi에 연결돼 있어야 한다.

## 실행 명령

```bash
cd frontend && npx expo run:ios --device
```

연결된 기기 목록에서 iPhone을 선택하면 빌드 후 자동 설치·실행된다. 최초 빌드 시 코드 사이닝 키체인 접근 요청 팝업이 뜨면 **맥 로그인 비밀번호**를 입력한다(Apple ID 비밀번호 아님). "항상 허용"을 누르면 다음부터 안 물어본다.

## 매번 vs 가끔 해야 하는 일

| 빈도 | 해야 할 일 |
|------|-----------|
| 매번 개발할 때 | `cd frontend && npx expo start --dev-client` 실행, 맥·아이폰 같은 Wi-Fi 확인 |
| JS 코드만 변경 시 | 재빌드 불필요 — Metro가 Fast Refresh로 자동 반영 |
| 네이티브 설정 변경 시 (Info.plist, app.json plugins 등) | `npx expo run:ios --device` 재빌드 필요 |
| 7일마다 | 무료 Apple ID 서명 인증서 만료 → `npx expo run:ios --device` 재빌드로 갱신 |
| Wi-Fi/네트워크가 바뀌면 | `ipconfig getifaddr en0`로 IP 재확인 후 `frontend/.env` 갱신 |
| 개발자 모드를 직접 껐다면 | 다시 켜야 개발 빌드 실행 가능 |

## 트러블슈팅 (실제 겪은 에러)

| 에러 메시지 | 원인 | 해결 |
|------------|------|------|
| `CommandError: No code signing certificates are available to use.` | Xcode에서 Signing Team 미설정 | 위 "1. Xcode 서명 설정" 참고 |
| `error:Developer Mode disabled To use <기기명> for development, enable Developer Mode` | 아이폰 개발자 모드 꺼짐 | 위 "2. iPhone 개발자 모드 활성화" 참고 |
| "신뢰하지 않는 개발자" 팝업, 앱 실행 안 됨 | 개발자 인증서 미신뢰 | 위 "3. 신뢰되지 않는 개발자 허용" 참고 |
| `No script URL provided. Make sure the packager is running...` | Metro 번들러 미실행 또는 연결 안 됨 | `npx expo start --dev-client` 실행 확인, 앱에서 새로고침 |
| "서버에 연결할 수 없어요" / `localhost:8080` 관련 에러 | `.env`의 `EXPO_PUBLIC_API_BASE_URL`이 `localhost`로 남아있음 | 위 "4. 백엔드 주소 변경" 참고 — 실기기는 반드시 LAN IP 필요 |

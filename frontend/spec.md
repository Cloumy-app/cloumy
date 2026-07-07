# 프론트엔드 구현 가이드

## 기술 스택

| 구성 요소 | 기술 | 이유 |
|-----------|------|------|
| 언어 | TypeScript | 타입 안전성, 런타임 에러 감소 |
| 프레임워크 | React Native + Expo | iOS/Android 동시, OTA 업데이트 |
| 라우팅 | Expo Router | 파일 기반 라우팅 |
| 상태 관리 | Zustand | 보일러플레이트 최소 |
| 서버 상태 | TanStack Query | 캐싱, stale-while-revalidate |
| 지도 | react-native-maps (Google Maps) | Day별 경로 폴리라인, 핀 클러스터링 |
| 실시간 | socket.io-client | 챗봇 스트리밍, 그룹 동기화 |
| UI 컴포넌트 | NativeWind v4 + Tailwind v3 | 와이어프레임 Tailwind 클래스 직접 이식 가능 |
| 폼 | React Hook Form + Zod | 루트 생성 Step 입력, 예산 폼 |
| 결제 | react-native-webview | ⚠️ PG 미확정 — 토스페이먼츠는 국내 전용이라 재검토 필요, Stripe 등 국제결제 검토 중 |
| 차트 | Victory Native | 예산 도넛 차트, 지출 리포트 (구현 완료) |
| 로컬 저장 | MMKV | AsyncStorage 대비 10~30x 빠름. 토큰·캐시 저장 |
| 딥링크 | Expo Linking | Naver/Google/카카오T 3-way 내비 분기 (계획, 현재 Google만 구현) |
| 다국어(i18n) | i18next + react-i18next + expo-localization | 한/영/일/중 4개 언어, MMKV 저장. 챗봇 화면 마이그레이션 완료(2026-07-06), 나머지 화면은 미마이그레이션 |

## 페이지 구성 및 라우팅

```
app/
├── (auth)/
│   ├── login.tsx             # 소셜 로그인 화면
│   └── onboarding.tsx        # 최초 온보딩
│
├── (tabs)/
│   ├── index.tsx             # 홈 (루트 목록, 최근 여행)
│   ├── explore.tsx           # 탐색 (지도 + Hidden Gems 피드)
│   ├── chat.tsx              # AI 챗봇
│   └── profile.tsx           # 프로필, 패스 관리
│
├── route/
│   ├── create/
│   │   ├── step-1.tsx        # 목적지·날짜·인원
│   │   ├── step-2.tsx        # 여행 스타일·예산·태그
│   │   └── step-3.tsx        # 앵커 장소 선택
│   ├── [routeId]/
│   │   ├── index.tsx         # 루트 결과 (지도 + 타임라인)
│   │   ├── budget.tsx        # 예산·지출 관리
│   │   └── group.tsx         # 그룹 여행 모드
│
├── place/
│   └── [placeId].tsx         # 장소 상세
│
└── payment/
    ├── index.tsx             # 트립 패스 선택
    └── webview.tsx           # 결제 웹뷰 (PG 미확정)
```

## 핵심 컴포넌트 구조

```
components/
├── map/
│   ├── TripMap.tsx           # 루트 전체 지도 (Day별 색상 경로)
│   ├── DayRouteOverlay.tsx   # Day 탭 선택 시 해당 날 경로
│   ├── PlacePin.tsx          # 장소 핀 (번호, Hidden Gem 표시)
│   └── PlaceCard.tsx         # 핀 탭 시 팝업 카드
│
├── route/
│   ├── Timeline.tsx          # 하단 슬라이드업 타임라인
│   ├── SlotCard.tsx          # 일정 슬롯 카드 (📌🔄❌ 액션)
│   ├── ReshuffleSheet.tsx    # 재추천 대안 3개 시트
│   └── DayTabs.tsx           # Day 탭 네비게이션
│
├── chat/
│   ├── ChatBubble.tsx        # 채팅 말풍선
│   ├── ChatInput.tsx         # 입력창 (전송, 음성 예정)
│   └── ExpenseConfirm.tsx    # 챗봇 지출 파싱 확인 팝업
│
├── budget/
│   ├── BudgetDonut.tsx       # 예산 도넛 차트
│   ├── ExpenseList.tsx       # 지출 내역 리스트
│   ├── PlannedExpense.tsx    # 계획 지출 아이템 (체크박스)
│   └── UnplannedForm.tsx     # 비계획 지출 입력 폼
│
└── common/
    ├── PassGate.tsx          # 트립 패스 필요 시 게이트 UI
    ├── HiddenGemBadge.tsx    # 🔮 Hidden Gem 배지
    └── BudgetBanner.tsx      # 잔여 예산 배너 (상시 표시)
```

## 상태 관리 (Zustand)

```typescript
// stores/useAuthStore.ts
interface AuthStore {
  user: User | null;
  accessToken: string | null;
  passType: PassType;
  setUser: (user: User) => void;
  logout: () => void;
}

// stores/useRouteStore.ts
interface RouteStore {
  currentRoute: Route | null;
  selectedDay: number;
  mapViewMode: 'full' | 'day';
  setCurrentRoute: (route: Route) => void;
  setSelectedDay: (day: number) => void;
  toggleSlotPin: (slotId: string) => void;
  updateSlot: (slotId: string, slot: Partial<RouteSlot>) => void;
}

// stores/useChatStore.ts
interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (msg: ChatMessage) => void;
  appendChunk: (chunk: string) => void;
}

// stores/useBudgetStore.ts
interface BudgetStore {
  budget: BudgetSummary | null;
  expenses: Expense[];
  addExpense: (expense: Expense) => void;
  updateExpense: (id: string, expense: Partial<Expense>) => void;
}
```

## UI/UX 핵심 결정 사항

### 지도 인터랙션
- **기본 화면**: 전체 루트 지도 (Day별 색상 구분 경로선)
- **Day 탭 탭**: 해당 날 경로만 필터링 + 경로선 위 이동 시간 표시
- **핀 탭**: 장소 카드 팝업 (사진, 예상 체류, 예상 비용, Hidden Gem 여부)
- **하단 슬라이드업**: 타임라인 뷰 (지도와 실시간 연동 — 카드 탭 시 핀 포커스)

### Pin & Reshuffle UX
- 슬롯 카드 우측 아이콘: 📌 고정 / 🔄 재추천 / ❌ 제거
- 🔄 탭 시: 하단 시트로 대안 3개 슬라이드 표시
- 선택 즉시 지도 경로 실시간 업데이트

### 챗봇 지출 파싱 UX
- 챗봇이 지출을 감지하면 "이 지출을 기록할까요?" 확인 카드 표시
- 원탭으로 확인 / 카테고리 수정 후 확인

### 예산 초과 UX
- 잔여 예산 배너 상시 표시 (화면 상단 고정)
- 초과 시 배너 색상 변경 + 챗봇 팝업 ("남은 일정 저가 대안을 찾아볼까요?")

## 반응형 / 플랫폼별 처리

| 항목 | iOS | Android |
|------|-----|---------|
| 소셜 로그인 | 구글·애플 (카카오는 국내 전용이라 보류) | 구글 (애플 불필요) |
| 결제 | 웹뷰 (앱스토어 정책) | 웹뷰 (플레이스토어 정책) |
| 딥링크 | Expo Linking + Universal Links | Expo Linking + App Links |
| 지도 | react-native-maps Google Maps | react-native-maps Google Maps |

## 코딩 컨벤션

- 컴포넌트: PascalCase (`SlotCard.tsx`)
- 훅: `use` 접두사 (`useRouteSocket.ts`)
- 스토어: `use` + Store 접미사 (`useRouteStore.ts`)
- API 함수: camelCase (`generateRoute`, `fetchExpenses`)
- 상수: UPPER_SNAKE_CASE (`MAX_ANCHOR_PLACES = 5`)
- 타입/인터페이스: PascalCase, 파일은 `types/` 디렉토리 집중
- 절대 경로: `@/components`, `@/stores`, `@/types`

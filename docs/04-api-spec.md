# API 명세

## 설계 원칙
- **REST** 기반 (HTTPS JSON)
- 챗봇 스트리밍은 **WebSocket** 사용
- 그룹 실시간 동기화는 **WebSocket + Redis Pub/Sub**
- Base URL: `https://api.cloumy.app/v1`
- 모든 인증 필요 요청에 `Authorization: Bearer {accessToken}` 헤더 포함

## 인증 방식

### 소셜 로그인 플로우
```
1. 클라이언트 → 카카오/구글/애플 OAuth 인증 → OAuth Access Token 획득
2. POST /auth/social → Cloumy JWT 발급
3. 이후 모든 요청: Authorization: Bearer {accessToken}
4. Access Token 만료(1시간) → POST /auth/refresh → 새 토큰 발급
5. 로그아웃: POST /auth/logout → Refresh Token 블랙리스트 등록
```

## 에러 처리 규칙

```json
{
  "code": "ROUTE_NOT_FOUND",
  "message": "해당 루트를 찾을 수 없습니다.",
  "status": 404
}
```

| HTTP 상태 | 의미 |
|-----------|------|
| 200 | 성공 |
| 201 | 생성 성공 |
| 400 | 잘못된 요청 (유효성 검사 실패) |
| 401 | 인증 필요 (토큰 없거나 만료) |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 429 | Rate Limit 초과 (LLM 과호출 방지) |
| 500 | 서버 내부 오류 |

---

## 엔드포인트 목록

### 인증 (Auth)

#### POST /auth/social
소셜 로그인 후 Cloumy JWT 발급

```json
// 요청 — provider: 'google' | 'apple' 우선 (카카오는 국내 전용이라 보류, 재검토 필요)
{
  "provider": "google",
  "oauthAccessToken": "google_oauth_token_here"
}

// 응답 201
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "uuid",
    "nickname": "여행자123",
    "profileImageUrl": "https://..."
  }
}
```

#### POST /auth/refresh
Access Token 갱신

```json
// 요청
{ "refreshToken": "eyJ..." }

// 응답 200
{ "accessToken": "eyJ..." }
```

#### POST /auth/logout
```json
// 요청
{ "refreshToken": "eyJ..." }
// 응답 200
```

---

### 루트 생성 (Route)

#### POST /routes/generate
AI 루트 생성 (스트리밍 응답)

```json
// 요청
{
  "destination": "부산",
  "startDate": "2026-07-10",
  "endDate": "2026-07-12",
  "groupType": "friends",
  "tags": ["먹방", "힐링"],
  "budgetLevel": "mid",
  "density": "normal",
  "transportMode": "transit",
  "accommodationArea": "해운대",
  "anchorPlaces": ["place-uuid-1"],
  "includeHiddenGems": true,
  "fixedSlots": [
    { "placeId": "place-uuid-2", "dayNumber": 1 }
  ]
}

// 응답 200 (스트리밍 JSON, Day별 순차 반환)
{
  "routeId": "uuid",
  "days": [
    {
      "dayNumber": 1,
      "slots": [
        {
          "placeId": "uuid",
          "placeName": "자갈치시장",
          "startTime": "10:00",
          "durationMinutes": 90,
          "estimatedCost": 15000,
          "transportToNext": "transit",
          "transportMinutes": 32,
          "transitSummary": "버스 143 → 지하철 2호선 (환승 1회)",
          "tips": "오전에 가면 싱싱한 회를 저렴하게 즐길 수 있습니다."
        }
      ]
    }
  ],
  "totalEstimatedCost": 280000
}
```

#### GET /routes/{routeId}
루트 상세 조회

#### PATCH /routes/{routeId}/slots/{slotId}/pin
슬롯 고정/해제

```json
// 요청
{ "isPinned": true }
```

#### POST /routes/{routeId}/slots/{slotId}/reshuffle
슬롯 재추천 (대안 3개 반환)

```json
// 응답 200
{
  "alternatives": [
    { "placeId": "uuid", "placeName": "광안리 카페", "estimatedCost": 8000, ... },
    { "placeId": "uuid", "placeName": "민락수변공원", "estimatedCost": 0, ... },
    { "placeId": "uuid", "placeName": "해운대 베이커리", "estimatedCost": 5000, ... }
  ]
}
```

#### DELETE /routes/{routeId}/slots/{slotId}
슬롯 제거 (AI가 빈 슬롯 자동 채우기)

#### POST /routes/{routeId}/slots
슬롯 삽입 — 챗봇 추천 카드를 일정에 넣을 때 쓴다

```json
// 요청
{
  "afterSlotId": "uuid | null",  // null이면 dayNumber 맨 앞에 삽입
  "dayNumber": 2,                // 필수 — afterSlotId가 null일 때 어느 Day인지
  "placeId": "uuid",
  "reason": "추천 이유 한 줄 (선택, 슬롯 tips에 저장돼 카드에 표시됨)"
}
// 응답 200: 해당 루트의 갱신된 전체 슬롯 목록
```

> **`afterSlotId`가 nullable인 이유 (2026-07-30)**: 사용자가 챗봇에 "경복궁 **가기 전에** 카페 들르고 싶어"라고 했을 때 경복궁이 그날 첫 일정이면 맨 앞에 넣어야 하는데, `@NotNull afterSlotId`로는 표현할 방법이 없었다. 빈 Day도 마찬가지. `dayNumber`는 `afterSlotId` 유무와 관계없이 **항상 필수** — 유무에 따라 필수 필드가 달라지면 클라이언트가 헷갈린다.
>
> 삽입 시 그 Day 뒤쪽 슬롯들의 `order_index`가 밀리고 시작 시각이 전부 재계산된다. 앞뒤 이웃의 이동정보도 다시 계산한다.

#### GET /routes
내 루트 목록 (정렬: display_order ASC — 수동 드래그 정렬 반영)

> ⚠️ 이 정렬은 여행 날짜와 무관하다. "지금 진행 중인 여행"이 필요하면 `GET /routes/active`를 쓸 것.

```
GET /routes?page=0&size=20
```

```json
// 응답 — Spring Page 봉투
{
  "success": true,
  "data": {
    "content": [
      {
        "id": "uuid",
        "title": "서울 2박 3일",
        "destination": "서울",
        "startDate": "2026-08-01",
        "endDate": "2026-08-03",
        "nights": 2,
        "createdAt": "2026-07-29T14:20:00",
        "isPublic": false,
        "departureAt": "2026-08-01T10:00:00+09:00",
        "returnAt": "2026-08-03T11:00:00+09:00"
      }
    ],
    "totalElements": 1, "totalPages": 1, "last": true
  }
}
```

> ⚠️ `departureAt` / `returnAt`은 **미입력이면 키 자체가 응답에서 빠진다** (전역 `default-property-inclusion: non_null`). `null`로 내려오지 않으므로 클라이언트는 `undefined`도 미입력으로 다뤄야 한다 — 프론트는 `routeMeta.departureAt ? new Date(...) : null` 형태로 처리 중.

단건 조회(`GET /routes/{routeId}`)도 같은 객체 형태를 반환한다.

#### PATCH /routes/reorder
내 루트 목록 수동 드래그 정렬 — 전체 순서를 담은 route ID 배열을 받아 display_order를 0..N-1로 일괄 재할당. 다른 유저 소유 route ID가 섞여 있으면 403.

```json
// 요청
{ "routeIds": ["uuid1", "uuid2", "uuid3"] }

// 응답 — 재정렬된 전체 목록
{ "success": true, "data": [ { "id": "uuid1", "title": "...", ... }, ... ] }
```

#### GET /routes/active
지금 도와줄 여행 하나를 서버가 판정해 반환한다 — **오늘이 기간에 걸치는 루트 → 없으면 가장 가까운 예정 루트 → 없으면 null**. 홈 배너와 챗봇 자동 개입이 이 값을 공유한다.

목록(`GET /routes`)의 첫 항목을 쓰면 안 된다. 목록 정렬 기준은 `display_order`(사용자 드래그 순서)라 여행 날짜와 무관하고, 페이지 크기 밖의 루트는 아예 보이지 않는다.

```json
// 응답 — 활성 루트가 있을 때
{ "success": true, "data": { "route": { "id": "uuid", "title": "...", "startDate": "2026-08-01", ... } } }

// 응답 — 없을 때 (route 키는 항상 존재한다)
{ "success": true, "data": { "route": null } }
```

#### PATCH /routes/{routeId}/departure
가는 편 출발 일시 설정(선택 입력) — 프로액티브 FLIGHT_DEPARTURE 규칙의 전제 조건(아래 프로액티브 섹션 참고). `departureAt`이 null이면 미입력 상태로 되돌린다.

**오프셋을 포함한 ISO 8601로 주고받는다.** 컬럼이 `TIMESTAMPTZ`이고 Java가 `OffsetDateTime`으로 매핑하므로, 오프셋 없는 문자열을 보내면 서버 타임존 해석에 의존하게 된다.

```json
// 요청 — UTC로 보내도 되고 KST 오프셋으로 보내도 된다 (같은 instant)
{ "departureAt": "2026-08-01T01:00:00.000Z" }

// 응답에 실릴 때는 항상 KST 오프셋으로 나온다
{ "departureAt": "2026-08-01T10:00:00+09:00" }
```

#### PATCH /routes/{routeId}/return
오는 편 출발 일시 설정(선택 입력) — 프로액티브 RETURN_DEPARTURE 규칙의 전제 조건. `departure`와 대칭이며 `returnAt`이 null이면 미입력 상태로 되돌린다.

`departureAt`이 이미 설정돼 있는데 그보다 이른 값을 보내면 400(`INVALID_INPUT`)이다.

```json
// 요청
{ "returnAt": "2026-08-03T11:00:00+09:00" }
```

---

### 챗봇 (Chatbot)

> 📌 실제 구현은 WebSocket 스트리밍이 아닌 REST 단발 응답 — 실제 요청/응답 구조는 `docs/06-ai-chatbot.md` 참고. 아래는 원래 계획 스펙에 다국어 `language` 필드와, 프로액티브 배너 탭 직후 첫 메시지에만 실리는 선택 필드 `proactiveContext`(문자열)를 반영.

#### WebSocket ws://api.cloumy.app/v1/chat

연결 후 메시지 형식:

```json
// 클라이언트 → 서버 — language: 사용자 메시지 언어 감지 결과, 다국어 응답에 사용 (구현 완료, 2026-07-06)
{
  "type": "message",
  "content": "3박 4일 부산, 친구 2명, 먹방 위주로",
  "language": "ko",
  "routeId": "uuid (여행 중 컨텍스트용, 선택)",
  "location": { "lat": 35.1796, "lng": 129.0756 }
}

// 서버 → 클라이언트 (스트리밍)
{ "type": "chunk", "content": "3박 4일 부산 여행..." }
{ "type": "chunk", "content": "Day 1은 자갈치시장..." }
{ "type": "done", "metadata": { "expenseParsed": null, "routeGenerated": true } }
```

```json
// 지출 자연어 파싱 예시
// 입력: "기념품 12,000원 썼어"
{ "type": "done", "metadata": { "expenseParsed": { "category": "SOUVENIR", "amount": 12000 } } }
```

---

### 프로액티브 (Proactive)

> 배경·규칙 설계는 `docs/superpowers/specs/2026-07-27-proactive-chatbot-design.md` 참고. 아래는 계약(엔드포인트 스펙)만 다룸.

#### GET /routes/{routeId}/proactive
지금 이 루트에 개입할 게 있는지 조회. 서버 응답에는 문구가 없다 — `type` + `params`만 내려주고, 실제 표현(문구)은 앱이 만든다.

```json
// 응답 200 — 개입 없음
// AI 서비스 장애·타임아웃일 때도 이 형태로 나간다(에러로 승격하지 않음, 아래 참고)
{ "success": true, "data": { "intervention": null } }

// 응답 200 — 개입 있음
{
  "success": true,
  "data": {
    "intervention": {
      "type": "DEPARTURE_SOON",
      "params": { "nextPlaceName": "자갈치시장", "minutesLeft": 8, "transportMinutes": 12 }
    }
  }
}
```

프로액티브는 부가 기능이라 **어떤 실패도 앱의 주 흐름을 막지 않는다** — AI 서비스 다운·타임아웃·5xx, Redis 다운, 날씨 API 오류는 모두 `intervention: null`로 수렴한다(404 ROUTE_NOT_FOUND만 에러로 내려간다). 앱은 이 필드가 비어 있으면 배너를 그리지 않으면 된다.

후보가 여러 개 뜨면 우선순위(priority) 최솟값 하나만 반환한다. 여행 전날(D-1)에는 `PRE_TRIP_BRIEFING` 하나만 평가되고, 여행 중에는 나머지 7종 중 하나가 평가된다.

`type`별 `params` 필드:

| type | priority | 뜨는 조건 | params |
|---|---|---|---|
| `PRE_TRIP_BRIEFING` | 1 | 여행 전날(D-1) | `nights`, `destination`, `flags`(아래 표) |
| `FLIGHT_DEPARTURE` | 1 | 가는 편 준비 — 출발 시각 기준 공항 이동시간+체크인 버퍼를 뺀 "지금 나가야 할 시각"까지 0~60분 (`departureAt` 미설정이면 평가 자체를 스킵). **여행 중뿐 아니라 여행 전날(D-1)에도 평가된다** — 새벽 항공편은 나서야 할 시각이 전날로 넘어가기 때문. D-1에 `PRE_TRIP_BRIEFING`과 동시에 후보가 되면 이쪽이 이긴다 | `departureAt`, `leaveByTime` |
| `RETURN_DEPARTURE` | 1 | 오는 편 준비 — `FLIGHT_DEPARTURE`와 같은 계산을 `returnAt`에 적용 (미설정이면 스킵) | `returnAt`, `leaveByTime` |
| `DEPARTURE_SOON` | 2 | 다음 일정 출발까지 0~15분 (위치 추정 confidence가 high일 때만) | `nextPlaceName`, `minutesLeft`, `transportMinutes` |
| `EMPTY_DAY` | 3 | 오늘 슬롯이 1개 이하 (정오 이전에만) | `day`, `slotCount` |
| `WEATHER_ALERT` | 4 | 오늘 실외 슬롯이 있고 비/폭염/한파 예보 | `day`, `kind`(`rain`\|`heat`\|`cold`), `outdoorCount` |
| `BUDGET_OVER` | 5 | 오늘 지출이 하루 예산의 1.2배 초과 | `spentToday`, `dailyBudget` |
| `BOOKMARK_NEARBY` | 6 | 추정 위치 반경 500m 내 유저 북마크 존재 (위치 추정 confidence가 high일 때만) | `placeName`, `distanceM` |
| `FREE_GAP` | 7 | 현재 슬롯 종료~다음 슬롯 사이 공백이 이동시간+60분 이상 (위치 추정 confidence가 high일 때만) | `gapMinutes` |

`PRE_TRIP_BRIEFING.params.flags`는 진단 배열이다(0개면 브리핑 자체가 뜨지 않음). `kind`별 필드:

| flags[].kind | 부가 필드 |
|---|---|
| `rain` / `heat` / `cold` | 없음 |
| `packed_day` | `day` |
| `far_from_stay` | `day`, `distanceM` |
| `long_walk` | `day`, `minutes` |
| `first_slot` | `time`, `placeName` |

#### POST /routes/{routeId}/proactive/feedback
배너 탭/닫기 계측. **DB에 저장하지 않고 로그만 남긴다**(베타 규모에서는 grep으로 충분하다는 판단).

```json
// 요청 — action: tapped | dismissed
{ "type": "DEPARTURE_SOON", "action": "tapped" }
```

---

### 예산 & 지출 (Budget)

#### GET /routes/{routeId}/budget
예산 설정 및 지출 현황 조회

```json
// 응답 200
{
  "totalBudget": 300000,
  "settings": {
    "accommodationRatio": 0.35,
    "foodRatio": 0.30,
    "transportRatio": 0.20,
    "activityRatio": 0.10,
    "etcRatio": 0.05
  },
  "totalSpent": 180000,
  "plannedSpent": 150000,
  "unplannedSpent": 30000,
  "remaining": 120000,
  "byCategory": {
    "ACCOMMODATION": { "planned": 105000, "actual": 105000 },
    "FOOD": { "planned": 90000, "actual": 62000 }
  }
}
```

#### PATCH /routes/{routeId}/budget
예산 설정 업데이트

#### POST /routes/{routeId}/expenses
지출 추가

```json
// 요청
{
  "slotId": "uuid (없으면 비계획)",
  "expenseType": "unplanned",
  "category": "SOUVENIR",
  "actualAmount": 12000,
  "memo": "자갈치 마그넷"
}
```

#### PATCH /routes/{routeId}/slots/{slotId}/expenses/{expenseId}
계획 지출 완료 체크 / 금액 수정

#### POST /v1/routes/{routeId}/budget-settings
루트 생성 시 총예산을 입력하지 않아 예산 설정이 없는 경우, 예산 관리 화면에서 최초 1회 설정. 이미 설정돼 있으면 409(BUDGET_ALREADY_SET).

```json
// 요청
{ "totalBudget": 500000 }
```

---

### Hidden Gems (Community)

#### GET /places/hidden-gems
Hidden Gems 목록 (필터 지원)

```
GET /places/hidden-gems?tags=먹방,카페&lat=35.17&lng=129.07&radius=5000&page=0
```

#### POST /places/hidden-gems
Hidden Gem 등록

```json
// 요청 (multipart/form-data)
{
  "placeName": "골목 비밀 국수집",
  "location": { "lat": 35.1012, "lng": 129.0259 },
  "address": "부산 중구 광복동",
  "tags": ["먹방", "현지인픽", "웨이팅없음"],
  "photo": "(이미지 파일)",
  "gpsVerified": true
}
```

#### GET /places/{placeId}
장소 상세 조회

---

### 그룹 여행 (Group)

#### POST /group-trips
그룹 여행방 생성

```json
// 요청
{ "routeId": "uuid" }

// 응답 201
{
  "groupTripId": "uuid",
  "inviteCode": "CLOUMY-ABC123",
  "inviteUrl": "https://cloumy.app/join/CLOUMY-ABC123"
}
```

#### POST /group-trips/join
초대 코드로 참여

```json
// 요청
{ "inviteCode": "CLOUMY-ABC123" }
```

#### WebSocket ws://api.cloumy.app/v1/group/{groupTripId}
그룹 실시간 동기화

```json
// 슬롯 투표
{ "type": "vote", "slotId": "uuid", "vote": "like" }

// 서버 브로드캐스트
{ "type": "slot_updated", "slotId": "uuid", "likes": 2, "dislikes": 1 }
```

---

### 결제 (Payment)

#### POST /payments/trips
트립 패스 결제 시작

> ⚠️ **PG 미확정**: 아래는 토스페이먼츠 기준 예시였으나, 국내 전용 PG라 외국인 해외 카드 결제를 지원하지 않아 재검토 중(Stripe 등 후보, `docs/02-architecture.md` ADR-6 참고). 결제 기능 자체가 미구현이라 실제 스펙은 PG 확정 후 변경될 수 있음.

```json
// 요청
{ "passType": "standard" }

// 응답 200
{
  "orderId": "cloumy-order-uuid",
  "amount": 4.99,
  "currency": "USD",
  "successUrl": "https://cloumy.app/payment/success",
  "failUrl": "https://cloumy.app/payment/fail"
}
// → 클라이언트가 (PG 미확정) 결제 웹뷰 오픈
```

#### POST /payments/trips/confirm
결제 완료 서버 사이드 검증

```json
// 요청 — paymentKey는 PG 확정 후 실제 필드명으로 변경될 수 있음
{ "paymentKey": "pg_transaction_key", "orderId": "cloumy-order-uuid", "amount": 4.99 }

// 응답 200
{ "passType": "standard", "passExpiresAt": "2026-07-14T23:59:59Z" }
```

---

### 장소 검색 (Places)

#### GET /places/search
장소 검색 (텍스트 + 위치 기반)

```
GET /places/search?q=광안리&lat=35.15&lng=129.11&radius=3000&tags=힐링
```

```json
// 응답 200
{
  "places": [
    {
      "id": "uuid",
      "name": "광안리해수욕장",
      "location": { "lat": 35.153, "lng": 129.118 },
      "categoryTags": ["힐링", "뷰맛집"],
      "isHiddenGem": false,
      "rarityScore": 15
    }
  ],
  "total": 23
}
```

## API 버전 관리
- URL 경로 버전 관리: `/v1/`, `/v2/`
- Major 변경(하위 호환 불가) 시 버전 업
- 구 버전은 6개월 유지 후 Deprecation 공지

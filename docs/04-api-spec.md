# API 명세

> **진실의 출처는 컨트롤러다.** 이 문서는 `backend/src/main/java/**/controller/` 11개와 `ai/app/routes/` 6개를 읽어 정리한 것이고, 어긋나면 코드가 맞다.
> 기준일 **2026-08-06** · 공개 API **52개** + 내부 API **6개**

---

## 설계 원칙

- **REST / HTTPS JSON**, Base URL `https://api.cloumy.app` — 경로에 `/v1`이 포함된다 (`/v1/routes` 등)
- 인증 필요 요청은 `Authorization: Bearer {accessToken}`
- **스트리밍은 SSE 하나뿐이다** — 루트 생성(`POST /v1/routes/generate`). **WebSocket은 쓰지 않는다.** 챗봇도 일반 POST 요청/응답이다
- Spring은 FastAPI 앞의 **프록시 겸 SSE 중계**다. 앱은 FastAPI에 직접 붙지 않는다

### 인증 필요 없는 경로 (`SecurityConfig:46`)

```
/v1/auth/**        소셜 로그인·갱신·로그아웃
/v1/dev/**         @Profile("dev") 전용 — prod에는 빈 자체가 없어 404
/actuator/health
/error
```

그 외 **전부 인증 필요**(`anyRequest().authenticated()`).

### 소셜 로그인 플로우

```
1. 앱 → 구글/애플 OAuth → OAuth Access Token 획득
2. POST /v1/auth/social → Cloumy JWT(access + refresh) 발급
3. 이후 모든 요청에 Authorization: Bearer {accessToken}
4. Access Token 만료 → POST /v1/auth/refresh
5. 로그아웃 → POST /v1/auth/logout (refresh 토큰 블랙리스트)
```

> ⚠️ **Apple 서명 검증이 미구현이다** (`planning/unimplemented.md` 🔴). 카카오는 국내 전용이라 외국인 타겟과 안 맞아 보류 상태다.

---

## 응답 껍데기

**모든 응답이 같은 봉투에 담긴다** (`ApiResponse.java`). `null` 필드는 직렬화에서 빠진다(`@JsonInclude(NON_NULL)`).

```json
// 성공
{ "success": true, "data": { ... } }

// 데이터 없는 성공 (DELETE, 로그아웃)
{ "success": true }

// 실패
{ "success": false, "error": { "code": "ROUTE_NOT_FOUND", "message": "루트를 찾을 수 없습니다" } }
```

HTTP 상태 코드는 봉투가 아니라 `ErrorCode`가 들고 있다.

### ErrorCode 전체 (`ErrorCode.java`)

**이 목록이 곧 도메인 지도다** — 실패할 수 있는 모든 경우가 여기 열거돼 있다.

| 상태 | code | 언제 |
|---:|---|---|
| 401 | `TOKEN_EXPIRED` `TOKEN_INVALID` `TOKEN_REVOKED` `TOKEN_UNSUPPORTED` | JWT 4종 |
| 502 | `OAUTH_ERROR` `OAUTH_USER_INFO_FAILED` | 소셜 로그인 중계 실패 |
| 404 | `USER_NOT_FOUND` `ROUTE_NOT_FOUND` `SLOT_NOT_FOUND` `PLACE_NOT_FOUND` `ACCOMMODATION_NOT_FOUND` `BUDGET_SETTINGS_NOT_FOUND` `EXPENSE_NOT_FOUND` | |
| 403 | `ROUTE_ACCESS_DENIED` `FORBIDDEN` | 소유권 검증 실패 |
| 409 | `ONBOARDING_ALREADY_COMPLETED` `BUDGET_ALREADY_SET` | |
| 400 | `INVALID_PERSONA_TAG` `SLOT_PINNED` `INVALID_SLOT_ORDER` `INVALID_CITY` `GPS_VERIFICATION_FAILED` `INVALID_BUDGET_RATIO` `INVALID_INPUT` | |
| **402** | `PASS_REQUIRED` `PASS_EXPIRED` | 트립 패스 가드 |
| 429 | `RATE_LIMIT_EXCEEDED` | `Retry-After` 헤더 동봉 |
| 502 | `KAKAO_API_ERROR` | 숙소 검색 실패 |
| 500 | `INTERNAL_ERROR` | 스택은 로그에만 |

`@Valid` 실패는 `ErrorCode`를 안 거치고 **422 + 필드별 메시지**로 나간다(`GlobalExceptionHandler`).

> ⚠️ **에러 JSON을 만드는 곳이 3군데다.** 필터 체인(`JwtAuthenticationFilter`, `RateLimitFilter`)은 `@RestControllerAdvice`보다 앞이라 `GlobalExceptionHandler`가 못 잡는다. 형태(`ApiResponse.error`)만 통일돼 있다.

### Rate Limit (`RateLimitFilter.java:36`)

Redis ZSet 슬라이딩 윈도우, 키는 `userId` 기준. **걸린 경로는 3개뿐**이다.

| 경로 | 한도 |
|---|---|
| `POST /v1/routes/generate` | 3회 / 60초 |
| `POST /v1/chat` | 10회 / 60초 |
| `GET /v1/routes/*/proactive` | 30회 / 60초 — 앱 진입마다 호출돼 넉넉히 |

**Redis 장애 시 fail-open** — 로그만 남기고 통과시킨다. 레이트리밋 때문에 서비스가 멈추는 게 더 나쁘다.

---

## 엔드포인트 — 전체 52개

### 인증 · 사용자 (6)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/v1/auth/social` | 소셜 로그인 → JWT 발급 |
| POST | `/v1/auth/refresh` | Access Token 갱신 |
| POST | `/v1/auth/logout` | Refresh 토큰 블랙리스트 |
| POST | `/v1/dev/token` | **dev 프로파일 전용** 테스트 토큰 |
| GET | `/v1/users/me` | 내 정보 (페르소나 태그·온보딩 여부 포함) |
| POST | `/v1/users/me/onboarding` | 페르소나 태그 10종 선택 완료 |

### 루트 (16) — `RouteController`

| 메서드 | 경로 | 설명 |
|---|---|---|
| **POST** | **`/v1/routes/generate`** | **AI 루트 생성 (SSE)** — 아래 상세 |
| POST | `/v1/routes/manual` | AI 없이 빈 루트 생성 |
| GET | `/v1/routes` | 내 루트 목록 (`display_order` 정렬) |
| GET | `/v1/routes/active` | 오늘 진행 중인 루트 — **`status` 컬럼 없이 날짜로 판정** |
| GET | `/v1/routes/{routeId}` | 루트 상세 |
| DELETE | `/v1/routes/{routeId}` | 삭제 |
| GET | `/v1/routes/{routeId}/day-summaries` | Day별 AI 요약 |
| PATCH | `/v1/routes/reorder` | 목록 수동 드래그 정렬 |
| PATCH | `/v1/routes/{routeId}/visibility` | 커뮤니티 공개/비공개 |
| PATCH | `/v1/routes/{routeId}/departure` | 가는 편 출발 일시 (프로액티브 T1 기준값) |
| PATCH | `/v1/routes/{routeId}/return` | 오는 편 출발 일시 |
| GET | `/v1/routes/public` | 공개 루트 브라우징 (목적지 일치) |
| GET | `/v1/routes/{routeId}/public-slots` | 공개 루트의 슬롯 미리보기 |
| POST | `/v1/routes/{routeId}/clone` | 공유 루트 가져오기 |
| POST | `/v1/routes/{routeId}/bookmark` | 루트 북마크 |
| DELETE | `/v1/routes/{routeId}/bookmark` | 북마크 해제 |

### 슬롯 (7) — `RouteSlotController` · base `/v1/routes/{routeId}/slots`

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `` | 슬롯 목록 (좌표 포함) |
| POST | `` | 슬롯 추가 — **챗봇 장소 삽입이 여기로 온다** |
| PATCH | `/{slotId}` | 슬롯 수정 |
| DELETE | `/{slotId}` | 삭제 (`is_pinned`면 400 `SLOT_PINNED`) |
| PATCH | `/{slotId}/pin` | Pin 토글 |
| PATCH | `/reorder` | 재정렬 — **UNIQUE 제약 때문에 2패스** |
| POST | `/{slotId}/alternatives` | Pin & Reshuffle 대안 추천 (FastAPI 위임) |

### 예산 · 지출 (7) — `BudgetController` · base `/v1/routes/{routeId}`

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/budget-settings` | 예산 설정 조회 |
| POST | `/budget-settings` | 사후 설정 (있으면 409 `BUDGET_ALREADY_SET`) |
| PATCH | `/budget-settings/ratios` | 카테고리 비율 조정 (합 1.0 검증) |
| GET | `/expenses` | 지출 목록 |
| POST | `/expenses` | 지출 기록 |
| DELETE | `/expenses/{expenseId}` | 지출 삭제 |
| GET | `/budget-report` | 계획 대비 실지출 리포트 |

### 숙소 (5) — `AccommodationController`

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/v1/accommodations/search` | 카카오 로컬 검색 (502 `KAKAO_API_ERROR`) |
| GET | `/v1/accommodations/reverse-geocode` | 좌표 → 주소 |
| POST | `/v1/routes/{routeId}/accommodations` | 숙소 등록 |
| GET | `/v1/routes/{routeId}/accommodations` | 루트의 숙소 목록 |
| DELETE | `/v1/routes/{routeId}/accommodations/{accommodationId}` | 삭제 |

### 장소 · 탐색 (8) — `PlaceController` + `ExploreController`

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/v1/places/{placeId}` | 장소 상세 |
| GET | `/v1/places/search` | 장소 검색 |
| POST | `/v1/places/external` | **외부/수동 장소 find-or-create** — 카카오 검색·유저 직접 입력 공용 |
| GET | `/v1/places/browse` | 탐색 탭 목록 (PostGIS 반경) |
| POST | `/v1/places/{placeId}/bookmark` | 장소 북마크 |
| DELETE | `/v1/places/{placeId}/bookmark` | 해제 |
| GET | `/v1/bookmarks` | 내 북마크 목록 |
| GET | `/v1/bookmarks/by-city` | 도시별 그룹핑 |

### 챗봇 · 프로액티브 (3)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/v1/chat` | 여행 중 챗봇 — 상세는 `docs/06-ai-chatbot.md` |
| GET | `/v1/routes/{routeId}/proactive` | 개입 1건 조회 (**폴 방식 — 서버가 밀지 않는다**) |
| POST | `/v1/routes/{routeId}/proactive/feedback` | 개입 유용/무용 피드백 |

`GET /v1/routes/{routeId}/proactive`의 응답에는 문구가 없다 — `type` + `params`만 내려주고
실제 문구는 앱이 조립한다(판단은 규칙, 표현은 앱). 후보가 여러 개면 priority 최솟값 하나만 반환한다.

같은 날 닫은 개입은 서버가 걸러낸다 — Redis `proactive:dismissed:{userId}:{routeId}:{yyyy-MM-dd}`
SET에 `{TYPE}:{placeId}`(장소 무관 규칙은 `{TYPE}:-`)로 기록하고 `_select` **전에** 후보에서 제외한다.
장소 단위 규칙 6종은 같은 type이어도 장소가 다르면 별개로 닫힌다.

**개입 type 15종**:

| type | priority | params |
|---|---|---|
| `PRE_TRIP_BRIEFING` | 1 | `nights` `destination` `flags[]` |
| `FLIGHT_DEPARTURE` | 1 | `departureAt` `leaveByTime` |
| `RETURN_DEPARTURE` | 1 | `returnAt` `leaveByTime` |
| `LAST_TRANSIT` | 1 | `placeId` `placeName` `leaveByTime`(ISO datetime) `minutes` `fare`(nullable) |
| `CLOSED_DAY` | 1 | `placeId` `placeName` `day` |
| `DEPARTURE_SOON` | 2 | `nextPlaceName` `minutesLeft` `transportMinutes` |
| `BREAK_TIME` | 2 | `placeId` `placeName` `breakStart` `breakEnd`(`HH:MM:SS`) |
| `RESERVATION_WALL` | 2 | `placeId` `placeName` `reservationPlatform`(nullable) |
| `PAYMENT_WALL` | 2 | `placeId` `placeName` `kind`(`cash_only`\|`no_foreign_card`) |
| `EMPTY_DAY` | 3 | `day` `slotCount` |
| `LAST_ENTRY` | 3 | `placeId` `placeName` `lastEntryTime` `closeTime`(`HH:MM:SS`) |
| `WEATHER_ALERT` | 4 | `day` `kind`(`rain`\|`heat`\|`cold`) `outdoorCount` |
| `BUDGET_OVER` | 5 | `spentToday` `dailyBudget` |
| `BOOKMARK_NEARBY` | 6 | `placeName` `distanceM` |
| `FREE_GAP` | 7 | `gapMinutes` |

---

## 상세가 필요한 계약 2개

### POST /v1/routes/generate — SSE

나머지 51개와 성격이 완전히 다르다. **`ApiResponse` 봉투를 쓰지 않고**, 실패 처리 규칙도 다르다.

```
Content-Type: text/event-stream

event: route_id
data: {"routeId":"uuid"}        ← ▓ 이 순간 HTTP 200 확정 ▓

data: {"day":1,"order":0,"placeId":"...","placeName":"...", ...}   슬롯 1건
data: {"day":1,"summary":"..."}                                     Day 요약
   … NDJSON 한 줄씩 반복 …

data: {"done":true}
```

**설계에서 반드시 알아야 할 3가지**

1. **첫 이벤트를 보내는 순간 되돌릴 수 없다.** `emitter.send("route_id")`로 HTTP 200이 커밋되므로 이후엔 503을 줄 방법이 없다. 그래서 HTTP 에러(402 `PASS_REQUIRED`, 429 등)는 **전부 그 앞에서** 난다. 이후 실패는 3단 폴백으로 흡수한다 — *FastAPI 실패 → DB 유사 루트 폴백 → 그것도 없으면 `completeWithError`*.
2. **`done`을 named event로 안 보낸다.** 클라이언트가 named event를 못 받는 문제가 있어 일반 message로 보낸다(`RouteController.java:261`). 앱은 보험으로 `done` 리스너와 `close` 리스너를 함께 단다.
3. **줄 단위 저장은 별도 트랜잭션이다.** `saveStreamingLine`이 `REQUIRES_NEW`이고, **저장이 실패해도 스트림은 끊지 않는다.**

전체 흐름은 `docs/08-codebase-guide.md` 「흐름 A」에 시퀀스로 있다.

### POST /v1/chat — 응답이 문장만이 아니다

```json
{
  "reply": "…",
  "places": [ { "placeId": "...", "name": "...", "tags": "…", "isHiddenGem": false,
                "avgDurationMinutes": 60, "distanceM": 2400, "reason": "…" } ],
  "estimatedSlot": { "slotId": "uuid", "day": 1, "orderIndex": 2 },
  "insertion": { "day": 1, "afterSlotId": "uuid|null", "source": "conversation" }
}
```

`reply`를 뺀 3개는 전부 **nullable**이다 — 장소를 안 물어본 대화면 `places`가 없다.

`insertion.source`가 **앱의 행동을 결정한다** — `conversation`이면 확인 시트 없이 바로 삽입하고, 나머지 3종(`conversation_day` `estimated` `default`)은 확인 시트를 띄운다. 판단은 서버가 하고 앱은 그대로 따른다.

> ⚠️ **Spring → FastAPI 호출에 15초 타임아웃이 걸려 있다** (`AiServiceClient.java:211`). 초과하면 예외가 나면서 **카드가 아예 안 그려진다.** 챗봇 응답 시간을 늘리는 변경은 이 한도를 먼저 봐야 한다.

---

## 내부 API — Spring → FastAPI (6개)

앱에서 직접 부르지 않는다. 인증은 JWT가 아니라 **`X-Internal-Key` 헤더**다.

| 메서드 | 경로 | 호출 위치 |
|---|---|---|
| POST | `/ai/routes/generate` | 루트 생성 (NDJSON 스트림) |
| POST | `/ai/routes/slots/alternatives` | Pin & Reshuffle |
| POST | `/ai/routes/slots/transport` | 이동수단·소요시간 계산 |
| POST | `/ai/chat` | 챗봇 |
| GET | `/ai/proactive` | 프로액티브 규칙 평가 |
| POST | `/ai/places/translate` | 장소명 다국어 번역 |

> ⚠️ **HTTP/1.1만 지원한다.** HTTP/2로 붙이면 깨진다.

---

## 아직 없는 API — 문서에만 있던 것들

이전 버전이 아래를 명세로 적어놨지만 **컨트롤러가 없다.**

| 영역 | 실제 |
|---|---|
| Hidden Gems 등록·GPS 인증 | 컨트롤러 없음. `is_hidden_gem` 플래그만 존재 |
| 그룹 여행 (초대·멤버·실시간 동기화) | 컨트롤러·테이블 모두 없음. WebSocket도 안 씀 |
| 결제 (`/payments/**`) | 없음. `PassValidationService` 33줄이 전부, PG 미확정 |
| 챗봇 WebSocket 스트리밍 | 없음. `POST /v1/chat` 단발 요청/응답 |

---

## 다음에 볼 것

| 알고 싶은 것 | 어디로 |
|---|---|
| 챗봇 도구·모델 라우팅·비용 | `docs/06-ai-chatbot.md` ← 가장 정확 |
| AI 파이프라인 내부 (RAG·TSP) | `docs/05-ai-service-architecture.md` |
| 요청 1건이 지나는 필터 체인 | `docs/08-codebase-guide.md` |
| DB 스키마 | `docs/03-data-model.md` |
| 미해결 결함 | `planning/unimplemented.md` |

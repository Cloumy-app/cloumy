# AI 챗봇 (여행 중 실시간 어시스턴트)

> **범위**: 이 문서는 2026-07-05 구현된 **1단계**(여행 중 실시간 어시스턴트 + 읽기전용 도구 3개)를 실제 코드 기준으로 설명합니다. `04-api-spec.md`가 계획 당시 "챗봇 스트리밍은 WebSocket"이라 적어둔 것과 달리, 실제 1단계 구현은 **REST 단발 요청/응답(non-streaming)** 입니다 — 아래 [7장](#7-왜-streaming이-아니라-단발-응답인가)에서 이유를 설명합니다.
>
> **2026-07-27 업데이트(이슈 #143)**: **프로액티브 개입 엔진**이 신설되며 챗봇은 더 이상 "물으면 답하는" 리액티브 단독 구조가 아닙니다. 전체 흐름은 이제 **배너(프로액티브) → 챗봇(리액티브, 이 문서)** 로 이어집니다 — 프로액티브 엔진이 `GET /v1/routes/{routeId}/proactive`로 "지금 개입할 게 있는지"를 판단해 앱에 배너를 띄우고, 유저가 그 배너를 탭하면 이 문서가 설명하는 `POST /v1/chat` 리액티브 대화로 넘어옵니다(맥락 전달 방식은 아래 [3장](#3-요청-처리-흐름) 참고). 프로액티브 자체의 규칙·판단 로직은 이 문서의 범위가 아닙니다 — 설계는 `docs/superpowers/specs/2026-07-27-proactive-chatbot-design.md`, API 계약은 `docs/04-api-spec.md`의 "프로액티브" 절 참고.

## 목차
1. [한눈에 보기 — 지금 뭘 할 수 있나](#1-한눈에-보기--지금-뭘-할-수-있나)
2. [앞으로 될 것 (아직 미구현)](#2-앞으로-될-것-아직-미구현)
3. [요청 처리 흐름](#3-요청-처리-흐름)
4. [도구(Function Calling) 상세](#4-도구function-calling-상세)
5. [사용 모델 / 모델 라우팅](#5-사용-모델--모델-라우팅)
6. [DB / Redis 사용처](#6-db--redis-사용처)
7. [왜 streaming이 아니라 단발 응답인가](#7-왜-streaming이-아니라-단발-응답인가)
8. [토큰 사용 / 비용 특성](#8-토큰-사용--비용-특성)
9. [보안 — 소유권 검증 / Rate Limit](#9-보안--소유권-검증--rate-limit)
10. [설계 이유 요약](#10-설계-이유-요약)

---

## 1. 한눈에 보기 — 지금 뭘 할 수 있나

여행 중(진행 중인 루트가 있는 상태)인 사용자가 앱 하단 **AI 챗봇** 탭에서 자유롭게 말을 걸면, 아래 3가지 상황을 알아서 판단해 답합니다. 도구가 필요 없는 인사·잡담은 도구 호출 없이 바로 대화합니다.

| 사용자가 이런 말을 하면... | 챗봇이 하는 일 | 실제 테스트 응답 예시 |
|---|---|---|
| "근처 카페 추천해줘" | `search_nearby_places` 도구로 여행지 주변 실제 장소 DB 검색 | "서울 근처에서 찾은 카페들을 추천드려요! **로컬빌라베이글**, **도프뮤지엄 구월**, **BP:D 비피디 1호점**... 여행 일정 중 편한 시간에 방문해보세요!" *(+ 장소 카드 5개)* |
| "오늘 날씨 어때?" | `get_weather_forecast` 도구로 여행지 날씨 조회 | "오늘(7월 5일) 서울은 오전과 오후 내내 비가 올 예정입니다. 우산을 꼭 챙기시고, 실내 활동을 계획하세요!" |
| "지금 내 일정 어디까지 왔어?" | `get_route_status` 도구로 현재 루트의 Day별 장소·요약 조회 | "현재 1박 2일 서울 여행 일정이 준비되어 있습니다! **1일차**는 경교장, 식물학 아이파크몰 등 실내 감성 여행을, **2일차**는 성수동 카페와 서울숲을 방문하는 일정입니다." |
| "안녕", "고마워" 같은 잡담 | 도구 호출 없이 바로 대화 | 일반 대화형 응답 |

**다국어 응답 (2026-07-06 추가)**: 사용자가 보낸 메시지의 언어(영어/일본어/중국어/한국어)를 감지해 같은 언어로 답합니다. 시스템 프롬프트에 "사용자 메시지 언어로 답변하라"는 지시를 추가하는 방식 — 별도 번역 API를 쓰지 않고 Claude 자체 다국어 능력에 의존합니다. 방한 외국인 관광객 타겟 전환(`planning/milestones.md` Phase 2.5)의 1단계 산출물입니다.

**대화 맥락 유지(멀티턴)**: 같은 세션 안에서는 이전 대화를 기억합니다.
```
사용자: 내 이름은 지우야
챗봇:  안녕하세요, 지우님! 😊 서울 여행 즐겁게 하고 계신가요?

사용자: 내 이름이 뭐라고 했지?
챗봇:  지우님이라고 하셨어요! 😊 다른 도움이 필요하시면 말씀해주세요!
```
단, 이 기억은 **Redis에 2시간 TTL로만 저장**되며(앱 재실행과 무관, 2시간 지나면 초기화), 서버 DB에 대화 로그로 영구 저장되지는 않습니다.

**위치 정보 없이도 "지금 있을 법한 곳"을 추정 (2026-07-05 추가)**: 이 앱은 GPS를 아직 안 씁니다(그리고 리서치 결과, TripIt/Wanderlog/Citymapper 등 주요 여행 앱도 상시 GPS 추적에 의존하지 않음 — 의도적 설계). 대신 `routes.start_date` + `route_slots.start_time`만으로 "지금 서버 시각 기준 며칠째 몇 번 슬롯 근처겠다"를 추정합니다:
- **추정 가능(확신 높음)**: "근처 카페 추천해줘"라고만 물어도 도시 전체가 아니라 **그 추정 슬롯 근처**로 검색 반경이 좁아짐
- **추정 불가(확신 낮음)** — 오늘이 여행 기간이 아니거나 슬롯에 `start_time`이 비어있으면: 추측해서 답하지 않고 **"지금 어디 계신가요?"라고 먼저 되물음**. 사용자가 대화로 답하면(예: "나 강촌 근처야") 그 세션 동안은 그 답변이 자연스럽게 맥락으로 쓰임(별도 저장 로직 없이 기존 멀티턴 히스토리가 그대로 흡수)
- ✅ **해결됨(2026-07-05)**: 위에서 발견된 제약("`start_time`이 항상 NULL")을 해결했습니다. `ai/app/services/route_service.py`의 `_assign_start_times()`가 하루 시작(고정값 09:00)부터 `duration_minutes`/`transport_minutes`를 순서대로 누적해 `start_time`을 역산 — LLM이 시간을 직접 만들지 않고, 이미 계산된 소요시간을 그대로 재사용합니다. 슬롯 삽입(4-5)·교체 시에는 Spring `recomputeStartTimesForDay()`가 해당 day 전체를 같은 공식으로 다시 계산합니다.
  - 신규 루트로 실측 확인: `09:00 → 10:00 → 11:15 → ...` 식으로 정상 누적, 챗봇도 실제로 "확신 높음"으로 특정 슬롯 근처를 답함.
  - ⚠️ **새로 발견한 별개 제약**: 슬롯 삽입 시 새 슬롯의 `duration_minutes`를 장소의 `places.avg_duration_minutes`로 기본 채우게 했는데, 확인해보니 **`avg_duration_minutes`도 DB 전체 21,543건이 100% NULL**(수집 스크립트가 이 컬럼을 안 채움 — 스키마 기본값 60은 있으나 INSERT 시 명시적으로 NULL을 넣는 듯). 그래서 삽입된 슬롯은 지금도 duration 0으로 계산됨 — `places` 수집 스크립트 쪽 후속 작업 필요(이번 스코프 밖).

---

## 2. 앞으로 될 것 (아직 미구현)

노션 설계 문서("AI 엔진 상세 설계", "AI 기능 상세 설계 — 완전 가이드")에는 아래 기능까지 포함돼 있지만, 1단계에서는 의도적으로 제외했습니다.

| 예정 기능 | 예시 대화(설계 문서 기준, 아직 실제로는 안 됨) | 왜 미구현인가 |
|---|---|---|
| `record_expense` — 지출 기록 | "방금 카페에서 6천원 썼어" → "기록했어요! 오늘 식비 잔여 24,000원" | 예산 추적 기능 자체가 아직 없음(예산 "레벨" 선택 UI만 존재, 실제 지출 기록/조회 기능 미구현) — 선행 기능이 없어 도구를 만들 대상이 없음 |
| `get_budget_status` — 예산 현황 조회 | "오늘 예산 얼마 남았어?" → "총 30만원 중 8만5천원 사용(28%)" | 위와 동일 |
| `modify_route_slot` — 챗봇으로 일정 교체 | "여기 대신 다른 데 가고 싶어" → 대안 3곳 제시 | 이미 루트 화면의 **Pin & Reshuffle**(🔄 대안 추천 버튼)이 거의 동일한 기능을 제공 중 — 챗봇 안에서 중복 구현하는 대신 후순위로 미룸 |
| 여행 전 대화형 루트 생성 | "3박4일 제주도 가려는데" → 대화로 목적지/인원/예산을 물어보며 루트 자체를 생성 | 지금은 Step1~4 폼 입력으로만 루트 생성 가능. 대화형 생성은 별도 단계로 진행 예정 |
| **카메라 입력** (메뉴판·키오스크·간판 번역) | 메뉴판 사진 촬영 → 메뉴 전체 번역 + 추천 3개 하이라이트 / 키오스크 사진 → 단계별 주문 안내 | KOIN K-amera 벤치마킹 기능이나 아직 착수 전. Notion "3. 다국어 AI 챗봇" 문서 참고 |

이 스코프 결정은 `planning/milestones.md` Phase 2와 노션 태스크 페이지("AI 챗봇 1단계 — 여행 중 실시간 어시스턴트")에 기록돼 있습니다.

---

## 3. 요청 처리 흐름

```
[프론트엔드] app/(tabs)/chat.tsx
   │  사용자가 메시지 입력 → 가장 최근 루트를 컨텍스트로 자동 선택
   ▼
[Spring] POST /v1/chat  (ChatController.java)
   │  1. JWT에서 userId 추출
   │  2. RouteRepository로 routeId 소유권 검증 (없으면 404, 남의 루트면 403)
   │  3. AiServiceClient.chat() 호출 (X-Internal-Key, 15초 타임아웃)
   ▼
[FastAPI] POST /ai/chat  (chat.py → chat_service.handle_chat())
   │  1. route_id가 user_id 소유인지 다시 한번 검증 (이중 방어)
   │  2. Redis에서 이전 대화 히스토리 로드 (chat:{user_id}:{route_id})
   │  3. 모델 선택 (Haiku 기본, 복잡한 요청이면 Sonnet)
   │  4. Anthropic 호출 (tools=3개 포함)
   │     ├─ stop_reason == "tool_use" 면 → 도구 실행 → 결과를 다시 LLM에 전달 (최대 3라운드)
   │     └─ 최종 텍스트 답변이 나올 때까지 반복
   │  5. 답변을 Redis 히스토리에 추가 저장 (TTL 2시간, 최근 20턴만 유지)
   ▼
[Spring] ChatResponse { reply, places? } 그대로 클라이언트에 전달
   ▼
[프론트엔드] 답변 텍스트 렌더 + (search_nearby_places를 썼다면) 장소 카드 렌더
```

**`proactiveContext`(선택, 2026-07-27 추가)**: 프로액티브 배너를 탭한 직후 첫 메시지에만 함께 실려오는 문자열입니다(`ChatRequest.proactiveContext` → Spring `AiServiceClient.chat()` → FastAPI `ChatRequest.proactive_context`). 값이 있으면 `handle_chat()`이 시스템 프롬프트 끝에 `\n\n[방금 먼저 안내한 내용]\n{proactive_context}`를 덧붙여, 챗봇이 배너가 방금 무슨 얘기를 했는지 알고 자연스럽게 이어받아 답하도록 합니다(`ai/app/services/chat_service.py`).

**핵심 파일**
| 파일 | 역할 |
|---|---|
| `ai/app/routes/chat.py` | `POST /ai/chat` 엔드포인트, 요청/응답 Pydantic 스키마 |
| `ai/app/services/chat_service.py` | 도구 정의, 모델 라우팅, tool loop, Redis 세션 관리 — 핵심 로직 |
| `backend/.../trip/controller/ChatController.java` | `POST /v1/chat`, 소유권 검증 |
| `backend/.../trip/service/AiServiceClient.java` | FastAPI 호출 (`chat()` 메서드) |
| `backend/.../common/filter/RateLimitFilter.java` | `/v1/chat` 분당 10회 제한 |
| `frontend/app/(tabs)/chat.tsx` | 채팅 화면 UI |
| `frontend/stores/useChatStore.ts` | 메시지 목록/전송 상태 관리 |
| `frontend/lib/api/chat.ts` | Spring `/v1/chat` 호출 클라이언트 |

---

## 4. 도구(Function Calling) 상세

Anthropic의 [tool use](https://docs.anthropic.com/) 기능으로 구현. LLM이 스스로 "이 질문엔 어떤 도구가 필요한지" 판단하고, 필요하면 도구 이름 + 입력값을 반환 → 서버가 실제로 실행 → 결과를 다시 LLM에 주면 LLM이 그걸 바탕으로 자연어 답변을 만듭니다.

### 4-1. `search_nearby_places`
- **언제 호출되나**: "근처 맛집/카페/관광지 추천해줘" 류의 요청
- **입력**: `category_tags`(선택, 예: `['#카페']`), `radius_m`(선택, 기본 1500m)
- **실행 로직** (`_tool_search_nearby_places`): `PostgisTagRetriever`(`ai/app/services/retrievers.py`)를 그대로 재사용 — 루트 생성 때 후보 장소를 찾는 것과 **동일한 검색기**. 검색 중심 좌표 우선순위: **①현재 위치(있으면) → ②시간 기반 추정 슬롯 좌표(확신 높을 때만) → ③여행지 도시 중심**
- **참조 DB**: `places` 테이블 (`ST_DWithin` 반경 검색 + `category_tags &&` 배열 필터, `is_active = true`만)
- **반환**: 상위 5곳의 이름/태그/Hidden Gem 여부/평균 체류시간 + **`reason`(한줄 추천 이유, 2026-07-06 추가)** → 이 목록은 채팅 답변에 **장소 카드**로도 그대로 노출됨(`ChatResponse.places`)
- **`reason` 생성 방식**: 후보 5곳을 Haiku에 한 번에 보내 후보별 1문장 추천 이유를 받는다(`_generate_place_reasons`) — `slot_alternatives.py`(Pin&Reshuffle)와 동일한 index 기반 JSON 응답 패턴 재사용(place_id를 LLM이 직접 안 베끼게 해 환각 방지). 처음엔 LLM 호출 없이 태그만 잘라 붙이는 결정론적 폴백(`describe_candidate`, `retrievers.py`)만 썼다가, 다른 슬롯들의 풍부한 팁과 톤이 안 맞는다는 피드백으로 LLM 생성 방식으로 교체 — `describe_candidate`는 LLM 응답 파싱 실패 시의 폴백으로만 남음

### 4-2. `get_weather_forecast`
- **언제 호출되나**: "오늘/내일 날씨", "비 와?" 류의 요청
- **입력**: `date`(선택, YYYY-MM-DD, 기본 오늘)
- **실행 로직** (`_tool_get_weather_forecast`): `weather_service.py`의 내부 헬퍼(`_get_forecast_by_block`, `_label_for_day`)를 그대로 재사용 — 루트 생성 시 Day별 날씨 반영과 동일한 함수
- **외부 API**: OpenWeatherMap `/forecast` (무료 티어, 5일 이내만 조회 가능 — 5일 밖 날짜를 물으면 "예보 범위 밖" 답변)
- **DB 없음** — 여행지 좌표는 `CITY_CENTERS` 상수에서 조회

### 4-3. `get_route_status`
- **언제 호출되나**: "내 일정 어떻게 돼?", "지금까지 뭐 했지?", "다음 장소까지 어떻게 가?" 류의 요청
- **입력**: 없음 (routeId는 이미 요청 컨텍스트에 있음)
- **실행 로직** (`_tool_get_route_status`): 신규 작성한 조회 함수. **소유권 검증을 통과한 route**에 한해서만 조회.
- **참조 DB**: `route_slots`(day_number/order_index/start_time/is_pinned/**transport_to_next/transport_minutes/transit_summary** + `places.name` JOIN) + `route_day_summaries`(day별 한 줄 요약)
- 이동정보(`transport_to_next` 등)는 **루트 생성 시점에 이미 계산·저장된 값을 그대로 재사용** — 이 도구가 호출될 때 Tmap 등 외부 API를 새로 부르지 않음. `transit_detail`(승하차 정류장별 상세 JSON)은 답변 길이를 짧게 유지하기 위해 의도적으로 제외(요약 문장인 `transit_summary`만 사용)
- **`today_day`/`current_slot_order_index` 필드 (2026-07-06 추가)**: "오늘이 며칠째인지"는 원래 시스템 프롬프트 텍스트 힌트로만 전달됐는데, 모델이 그 힌트와 이 도구가 반환하는 전체 일정 덤프를 스스로 연결 짓지 못하고 "며칠째 여행 중이신가요?"라고 되묻는 문제가 실측됨(특히 이런 질문은 `_SONNET_KEYWORDS`에 안 걸려 기본 Haiku로 라우팅돼 문맥 연결이 더 약함). 도구 결과 자체에 `today_day`(현재 위치 추정이 `high`일 때만 값, 아니면 `null`)와 `current_slot_order_index`, 그리고 각 day 객체에 `is_today` 플래그를 직접 포함시켜 모델이 추론 없이 바로 답하도록 수정

### 4-4. 시간 기반 위치 추정 (`_estimate_current_slot`, 도구 아님)
- 도구 호출 여부와 무관하게 **매 요청마다 한 번** 계산돼 시스템 프롬프트에 힌트로 주입됩니다(위 [1장](#1-한눈에-보기--지금-뭘-할-수-있나) 참고)
- `routes.start_date` + `route_slots.day_number`로 "오늘이 며칠째 날인지" 계산 → 그날 슬롯들의 `start_time`과 서버 현재 시각(KST 명시 변환 필요 — 컨테이너는 UTC로 동작)을 비교해 "지금 지났거나 진행 중인 가장 최근 슬롯"을 선택
- 여행 기간 밖이거나, `start_time` 데이터가 없거나, 마지막 슬롯 시각을 한참 지났으면 `confidence: "low"`로 반환 — 이때는 좌표를 아예 안 씀
- `confidence: "high"`일 때만 그 슬롯의 `slot_id`/`day`/`order_index`가 `ChatResponse.estimated_slot`으로 그대로 노출됨 — 프론트가 "이 추천 장소를 지금 슬롯과 다음 슬롯 사이에 추가" 액션을 걸 때 기준점으로 사용(아래 4-5 참고)

### 4-5. 추천 장소 → 일정에 바로 추가 (2026-07-05 추가)
- `search_nearby_places` 결과 카드에 `place_id`를 포함시키고(기존엔 이름/태그만 있었음), `estimated_slot`이 `high`일 때만 카드를 탭 가능하게 표시
- 카드를 탭하면 프론트가 `POST /v1/routes/{routeId}/slots`(Spring 신규, body `{afterSlotId, placeId}`)를 호출 — `RouteSlotService.insertSlotAfter()`가 처리:
  1. 삽입 지점 뒤 슬롯들의 `order_index`를 **큰 값부터 내림차순으로** +1(오름차순으로 밀면 `(route_id, day_number, order_index)` UNIQUE 제약과 중간에 충돌)
  2. 새 슬롯 insert
  3. 앞/뒤 이웃 이동정보 재계산 — 기존 `replaceSlot`이 쓰던 `recalculateNeighborTransport`(→`AiServiceClient.getSlotTransport`)를 그대로 재사용, 외부 API는 새 구간 2개만 다시 호출
- `estimated_slot`이 `low`(위치 불확실)일 때는 삽입 UI 자체를 안 띄움 — 어디에 끼울지 기준점이 없기 때문
- **이동수단 미지정 라우트 기본값 (2026-07-06 수정)**: `routes.transport_mode`는 루트 생성 시 선택 사항이라 null인 경우가 많은데, 원래는 null이면 이동정보 재계산 자체를 건너뛰어 삽입된 슬롯에 이동시간이 아예 안 붙는 버그가 있었다. `transport_mode`가 null이면 `"car"`를 기본값으로 써서(`enrich_transport`가 이미 walk가 아니면 전부 자동차 속도로 근사하는 구조라 AI 쪽 변경 없이 재사용) 항상 근사치라도 보여주도록 수정 — `replaceSlot()`에는 동일한 가드가 아직 남아있어 같은 문제가 잠재함(`planning/unimplemented.md` 후속 과제로 기록)
- **`reason`이 `tips`로 영속화**: 카드의 `reason`(위 4-1 참고)이 삽입 요청에 함께 전달되어 새 슬롯의 `RouteSlot.tips`에 그대로 저장됨 — Pin&Reshuffle이 대안 교체 시 `tips`에 `reason`을 저장하는 것과 동일한 방식이라, 프론트 `SlotCard.tsx`가 이미 `tips`를 렌더링하고 있어 추가 작업 없이 자동으로 화면에 보임

### 공통 안전장치
- 도구 호출 → 결과 반영 → 재호출... 이 무한 반복되지 않도록 **최대 3라운드**로 캡(`MAX_TOOL_ROUNDS`)
- 도구 결과에 없는 장소를 답변에서 지어내지 말라고 시스템 프롬프트에 명시(완전한 환각 검증 로직은 아직 없음 — 후속 검토 대상)
- 위치를 추정했을 뿐 확답이 아니라면 "아마", "~일 수 있어요" 같은 표현을 쓰도록 시스템 프롬프트에 명시(확신 없는 추정을 단정적으로 말하지 않도록)
- 답변에 마크다운 문법(`**볼드**` 등)을 쓰지 말라고 시스템 프롬프트에 명시 — 채팅 화면이 마크다운을 렌더링하지 않아 `**`가 그대로 텍스트로 보이는 문제 방지

---

## 5. 사용 모델 / 모델 라우팅

| 모델 | 언제 쓰나 |
|---|---|
| `claude-haiku-4-5-20251001` | 기본값 — 대부분의 짧은 질문·도구 호출 |
| `claude-sonnet-4-6` | 메시지에 "일정 바꿔", "다시 짜", "전체", "계획", "루트", "며칠" 같은 키워드가 있거나, 현재 대화가 10턴 넘게 길어진 경우 |

라우팅은 별도 ML 분류기가 아니라 `_choose_model()`의 **키워드 매칭 + 대화 길이 휴리스틱**입니다(`chat_service.py`). 도구 호출 여부와 무관하게 두 모델 다 tool use를 지원하므로, 라운드마다 모델이 바뀌지는 않고 요청 시작 시 한 번만 정해집니다.

---

## 6. DB / Redis 사용처

### PostgreSQL
| 테이블 | 용도 |
|---|---|
| `routes` | 소유권 검증(`WHERE id=$1 AND user_id=$2`) + 여행지/기간 정보로 시스템 프롬프트 구성 |
| `places` | `search_nearby_places` 도구의 실제 장소 검색 대상 |
| `route_slots` | `get_route_status` 도구의 Day별 장소 목록 |
| `route_day_summaries` | `get_route_status` 도구의 Day별 요약 텍스트 |

### Redis
- **키 형식**: `chat:{user_id}:{route_id}`
- **값**: `[{role, content}, ...]` 형태의 JSON — **최종 답변 텍스트만** 저장하고, 도구 호출 중간 과정(tool_use/tool_result 블록)은 저장하지 않음. 그래서 세션이 길어져도 저장 용량이 크게 늘지 않음.
- **TTL**: 7200초(2시간)
- **길이 제한**: 40개(사용자+어시스턴트 합산 20턴) 초과 시 앞부분부터 잘라냄
- **장애 시**: Redis 접속 실패해도 에러를 던지지 않고 "히스토리 없음"으로 간주 후 정상 응답(fail-open) — 루트 생성 캐시와 동일한 철학

---

## 7. 왜 streaming이 아니라 단발 응답인가

루트 생성(`POST /ai/routes/generate`)은 NDJSON 스트리밍이지만, 챗봇 1단계는 **일반 REST 단발 요청/응답**입니다.

- 챗봇 답변은 2~3문장으로 짧아 스트리밍의 체감 이득이 크지 않음 (루트 생성은 슬롯 20개 이상을 순차 생성해서 스트리밍이 의미 있음)
- Function Calling의 tool loop는 "도구 호출 → 실행 → 재호출"을 몇 차례 왕복해야 최종 답변이 나오는 구조라, 중간 과정을 스트리밍으로 보여주기 애매함(도구 실행 중엔 보여줄 텍스트가 없음)
- 기존 SSE/NDJSON 인프라(Spring `SseEmitter` + 가상 스레드, FastAPI `StreamingResponse`)를 새로 얹지 않고 최소 구현으로 먼저 검증하기로 결정

추후 필요하면 `route_gen.py`의 NDJSON 패턴을 그대로 이식할 수 있습니다(설계상 막혀있지 않음).

---

## 8. 토큰 사용 / 비용 특성

- **Prompt Caching 미적용**: 루트 생성(`route_service.py`)은 시스템 프롬프트에 `cache_control: ephemeral`을 걸어 입력 비용을 크게 아끼지만, 챗봇의 시스템 프롬프트는 **매 요청 목적지·기간이 실시간으로 바뀌어 들어가는 동적 텍스트**라 캐시 재사용 이득이 작습니다. 1단계에서는 최적화하지 않고 그대로 둠 — 캐싱 여지가 있는 부분(도구 정의, 규칙 부분)을 분리해 캐싱하는 건 후속 개선 대상.
- **라운드당 비용**: tool loop 한 라운드가 돌 때마다 지금까지의 전체 대화(히스토리 + 도구 호출/결과)를 다시 통째로 모델에 전송합니다 — 라운드 수만큼 입력 토큰이 누적됩니다. `MAX_TOOL_ROUNDS=3`으로 상한을 걸어둔 이유이기도 합니다.
- **모델 라우팅으로 비용 절감**: 대부분의 요청은 저렴한 Haiku(`$1/$5` per 1M 토큰)로 처리되고, 복잡한 요청만 Sonnet(`$3/$15`)으로 넘어갑니다.
- **세션 히스토리는 텍스트만 저장**하므로 Redis 저장/전송 자체의 토큰 비용은 없음(Redis는 토큰과 무관, 순수 문자열 저장소).
- **`search_nearby_places` 호출마다 Haiku 1회 추가 (2026-07-06)**: 후보별 추천 이유(`reason`) 생성을 위한 별도 Haiku 호출 — Pin&Reshuffle(`slot_alternatives.py`)이 대안 추천마다 이미 하고 있는 것과 동일한 비용 수준.

---

## 9. 보안 — 소유권 검증 / Rate Limit

- **이중 소유권 검증**: Spring(`ChatController`)이 1차로 `RouteRepository.findById` + `userId` 비교로 막고, FastAPI(`chat_service._load_route`)가 2차로 `WHERE id=$1 AND user_id=$2` 쿼리로 다시 한번 확인합니다. FastAPI는 자체 JWT 인증이 없는(내부 `X-Internal-Key`만 검증하는) 서비스라, Spring이 위조된 routeId를 실수로 넘기더라도 FastAPI 단에서 막히도록 방어적으로 이중화했습니다.
- **Rate Limit**: `/v1/chat`은 사용자당 분당 10회(대화 특성상 루트 생성의 분당 3회보다 넉넉하게). `RateLimitFilter`의 매처 목록에 경로별로 다른 한도를 등록하는 방식으로 확장했고, 기존 `/v1/routes/generate`의 3회/분 정책은 그대로 유지됩니다.

---

## 10. 설계 이유 요약

| # | 설계 | 이유 |
|---|---|---|
| 1 | 루트 생성 서비스의 리소스(Anthropic 싱글턴, Retriever, weather_service 헬퍼)를 그대로 재사용 | 새 인프라를 만들지 않고 검증된 코드를 재사용 — `slot_alternatives.py`가 이미 쓰던 것과 동일한 import 패턴 |
| 2 | 읽기 전용 도구 3개만 먼저 구현 | 쓰기 도구(`record_expense` 등)는 선행 기능(예산 추적)이 없어 만들 수 없었고, 나머지(`modify_route_slot`)는 기존 기능과 중복이라 후순위로 미룸 |
| 3 | 대화 히스토리는 Redis에만, DB 영속화 안 함 | 세션성 데이터라 TTL 관리가 간단한 Redis가 적합 — 새 JPA 엔티티/마이그레이션 불필요 |
| 4 | FastAPI에서 소유권 재검증 | Spring이 이미 검증하지만, FastAPI가 다른 클라이언트에서도 직접 호출될 가능성을 고려해 서비스 경계에서 한번 더 방어 |
| 5 | non-streaming 단발 응답으로 시작 | 챗봇 답변이 짧고 tool loop 특성상 스트리밍 이득이 작아, 최소 구현으로 먼저 검증 후 필요 시 확장 |

# AI 서비스 구현 가이드

## 기술 스택

| 구성 요소 | 기술 | 비고 |
|-----------|------|------|
| 프레임워크 | Python FastAPI | 처음부터 Spring과 독립 분리 |
| AI 오케스트레이션 | LangChain | 파이프라인, Function Calling, 멀티턴 |
| 루트 LLM | Claude Sonnet 4.6 | 복잡한 JSON 구조, 긴 장소 목록 처리 |
| 경량 LLM | Claude Haiku 4.5 | 단순 질문, Pin&Reshuffle, 지출 파싱 |
| 임베딩 | OpenAI text-embedding-3-small | 1536차원, 비용 효율 |
| 벡터 DB | pgvector (PostgreSQL 확장) | 별도 인프라 불필요 |
| 동선 최적화 | OR-Tools TSP | 장소 간 이동 거리 최소화 |
| 캐시 | Redis | 챗봇 세션, 루트 결과 |
| 비동기 | FastAPI BackgroundTasks (MVP) → Kafka (Phase 2) | |

> ⚠️ API 키 이중 관리 필수:
> - `ANTHROPIC_API_KEY` — 루트 생성, 챗봇 (Claude)
> - `OPENAI_API_KEY` — 임베딩 생성 (text-embedding-3-small)

## 서비스 구조

```
cloumy-ai/
├── app/
│   ├── main.py
│   ├── routes/
│   │   ├── route_gen.py          # POST /ai/routes/generate
│   │   ├── slot_alternatives.py  # POST /ai/routes/slots/{slot_id}/alternatives
│   │   ├── chatbot.py            # WebSocket /ai/chat
│   │   ├── embedding.py          # POST /ai/embeddings (내부용)
│   │   └── scoring.py            # POST /ai/places/rarity-score
│   │
│   ├── services/
│   │   ├── rag_service.py      # pgvector 검색 + 카테고리 쿼터 보장
│   │   ├── tsp_service.py      # OR-Tools 동선 최적화
│   │   ├── model_router.py     # Haiku ↔ Sonnet 라우팅
│   │   ├── weather_service.py  # OpenWeatherMap 날씨 예보 (graceful fallback)
│   │   ├── fallback_service.py # Redis 1차 → DB 유사 루트 2차 폴백
│   │   ├── place_validator.py  # LLM 출력 place_id 재검증 + 유사 장소 교체
│   │   ├── expense_parser.py   # 자연어 지출 파싱
│   │   └── rarity_scorer.py   # 희소성 점수 계산
│   │
│   ├── prompts/
│   │   ├── route_gen.txt      # 루트 생성 시스템 프롬프트 (캐시됨)
│   │   └── chatbot.txt        # 챗봇 시스템 프롬프트
│   │
│   ├── models/
│   │   └── schemas.py         # Pydantic 모델
│   │
│   └── config/
│       ├── settings.py        # 환경 변수
│       └── database.py        # pgvector 연결
│
└── requirements.txt
```

## 기능별 모델 라우팅

| 기능 | 모델 | 이유 |
|------|------|------|
| AI 루트 생성 | Claude Sonnet 4.6 | 복잡한 JSON 구조 출력, 긴 장소 목록 처리 안정적 |
| 슬롯 대안 추천 | Claude Haiku 4.5 | 슬롯 단위 대안 3개 검색 → 저비용 충분 |
| 챗봇 단순 질문 | Claude Haiku 4.5 | 빠른 응답 (현지 추천, 거리 안내 등) |
| 챗봇 복잡 플래닝 | Claude Sonnet 4.6 | 멀티턴 컨텍스트 + Function Calling |
| 예산 자연어 파싱 | Claude Haiku 4.5 | 금액·카테고리 추출 단순 작업 |
| 검색 쿼리 생성 | Claude Haiku 4.5 | 입력값 → 검색 키워드 변환 |

## AI 루트 생성 LCEL 파이프라인

### Phase A — PostgisTagRetriever (현재)

```python
# Phase A 전체 흐름 (실제 구현 — ai/app/services/route_service.py)

# 1. Haiku LCEL: themes → category_tags 키워드 추출
tag_chain = tag_prompt | ChatAnthropic(model="claude-haiku-4-5") | JsonOutputParser()
tags = await tag_chain.ainvoke({"themes": user_input.themes})

# 2. PostgisTagRetriever: ST_DWithin + category_tags && (embedding 없음)
retriever = PostgisTagRetriever(db=db, city_coords=CITY_CENTERS[city], tags=tags)
candidates = await retriever.ainvoke("")

# 3. Sonnet 스트리밍 — Anthropic SDK 직접 사용 (LCEL astream 아님)
#    이유: LangChain ChatAnthropic의 cache_control 안정성 문제로 SDK 직접 사용
async with _anthropic.messages.stream(
    model="claude-sonnet-4-6",
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": f"후보 장소: {candidates}\n요청: {request}"}],
    max_tokens=4096,
) as stream:
    async for text in stream.text_stream:
        yield text  # ndjson 한 줄씩
```

### Phase B — PgvectorRetriever로 업그레이드 (앱 확인 후)

```python
# Phase B — Retriever만 교체, 나머지 체인 동일

# 1. Haiku LCEL: themes → 검색 쿼리 생성 (동일)
# 2. PgvectorRetriever: embedding <=> query_vec 유사도 검색
retriever = PgvectorRetriever(db=db, city_coords=CITY_CENTERS[city])
# → 멀티소스 병렬: pgvector 30개 + PostGIS 20개 + tag fallback

# 3. Sonnet LCEL 체인 (동일 — 변경 없음)
route_chain = (
    {"context": retriever, "request": RunnablePassthrough()}  # ← 이것만 변경
    | route_prompt | sonnet_llm | StrOutputParser()
)

# 4. 동선 최적화 (Phase B 추가)
optimized_slots = tsp_optimize(candidates, anchor_places=..., density=...)  # OR-Tools TSP

# 5. 환각 방지 검증 (Phase C)
validated_route = await validate_place_ids(route, db)
```

## Prompt Caching 전략 (비용 핵심)

```python
# 루트 생성 시스템 프롬프트는 거의 변하지 않음 → 캐싱으로 입력 비용 ~90% 절감

# Anthropic Prompt Caching 적용
messages = [
    {
        "role": "system",
        "content": [
            {
                "type": "text",
                "text": ROUTE_GEN_SYSTEM_PROMPT,  # 장소 DB 메타데이터 + 가이드라인
                "cache_control": {"type": "ephemeral"}  # 5분 캐시
            }
        ]
    },
    {
        "role": "user",
        "content": f"목적지: {destination}, 후보 장소: {json.dumps(candidates)}"
    }
]
```

## 챗봇 Function Calling

챗봇이 사용할 수 있는 도구:

```python
tools = [
    {
        "name": "search_nearby_places",
        "description": "현재 위치 근처 장소 검색",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number"},
                "lng": {"type": "number"},
                "category": {"type": "string"},
                "radius_m": {"type": "integer", "default": 500}
            }
        }
    },
    {
        "name": "record_expense",
        "description": "지출 기록",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": ["식음료", "교통", "기념품", "입장료", "기타"]},
                "amount": {"type": "integer"},
                "memo": {"type": "string"}
            },
            "required": ["category", "amount"]
        }
    },
    {
        "name": "get_remaining_budget",
        "description": "잔여 예산 조회",
        "input_schema": {
            "type": "object",
            "properties": {
                "route_id": {"type": "string"}
            },
            "required": ["route_id"]
        }
    },
    {
        "name": "suggest_alternatives",
        "description": "현재 슬롯 대안 장소 제안 (예산 초과, 웨이팅 등)",
        "input_schema": {
            "type": "object",
            "properties": {
                "slot_id": {"type": "string"},
                "reason": {"type": "string", "enum": ["over_budget", "waiting", "weather", "closed"]}
            }
        }
    }
]
```

## 챗봇 Redis 세션 구조

```python
# key: chat_session:{user_id}
# TTL: 24시간

session = {
    "route_id": "uuid",          # 현재 여행 루트
    "messages": [                 # 최근 20개 메시지 유지
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
    ],
    "context": {
        "current_location": {"lat": 35.17, "lng": 129.07},
        "current_day": 2,
        "remaining_budget": 85000
    }
}
```

## Hidden Gems 희소성 점수 알고리즘

```python
def calculate_rarity_score(kakao_review_count: int, naver_review_count: int, tour_api_visitors: int) -> float:
    # 가중 인지도 점수
    raw_score = (
        kakao_review_count * 0.5
        + naver_review_count * 0.3
        + tour_api_visitors * 0.2
    )

    # 전체 장소 분포에서 백분위 정규화 (0~100)
    percentile = get_percentile(raw_score, all_places_scores)

    # 희소성 = 100 - 인지도
    rarity_score = 100 - percentile

    return rarity_score

# Hidden Gem 등록 기준
# rarity_score >= 80 + GPS 인증 완료 + 사진 1장 이상

# 배지 자동 변화
# 80 이상 유지 → 🔮 Hidden Gem 배지 유지
# 50 미만 → "핫플이 됐어요 🔥" FCM 알림
# 30 미만 → 배지 자동 해제
```

## 응답 속도 목표

| 상황 | 목표 | 전략 |
|------|------|------|
| 첫 루트 생성 | 5~10초 | Sonnet 스트리밍, Day 1 먼저 표시 |
| 캐시 히트 | 1초 이내 | Redis 캐시 |
| 슬롯 대안 추천 (🔄) | 2~3초 | Haiku + 인접 슬롯 이동시간만 재계산 |
| 챗봇 단순 | 1~2초 | Haiku |
| 챗봇 루트 수정 | 3~5초 | Sonnet 스트리밍 |

## LLM 비용 추정 (MAU 1만 기준)

| 전략 | 월 비용 |
|------|---------|
| Claude Sonnet 4.6 단독 | ~$1,170 |
| Claude Haiku 4.5 단독 | ~$388 |
| **혼합 + Prompt Caching (채택)** | **~$170~$250** |

**비용 절약 레버:**
- Prompt Caching: 시스템 프롬프트 입력 비용 ~90% 절감
- 모델 라우팅: Haiku/Sonnet 비용 5~25x 차이 활용
- Redis 캐싱: 동일 조건 루트 재요청 시 LLM 재호출 없음
- Batch API: 비실시간 작업(임베딩 생성) 50% 할인

## 환경 변수

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...               # 임베딩 전용
POSTGRES_URL=postgresql://...
REDIS_URL=redis://...
GOOGLE_MAPS_API_KEY=...             # 좌표 검증용
KAKAO_REST_API_KEY=...              # 카카오 로컬 API (배치 + 실시간 보충)
OPENWEATHERMAP_API_KEY=...
TOURAPI_KEY=...
NAVER_SEARCH_CLIENT_ID=...          # 네이버 블로그 검색 (trend_score 갱신)
NAVER_SEARCH_CLIENT_SECRET=...
```

## AI 기능 개발 권장 순서

```
Week 1~2:  FastAPI 뼈대 + Claude API 연결 ✅ 완료
Week 3~4:  루트 생성 Phase A (LangChain LCEL + PostgisTagRetriever) + Spring SSE 프록시
Week 5:    앱에서 결과 확인 + 품질 평가
Week 6~7:  카카오 로컬 수집기 + KOPIS + OpenAI 임베딩 배치 (20,363건)
Week 7~8:  루트 생성 Phase B (PgvectorRetriever 교체) + OR-Tools TSP
Week 9~12: 챗봇 (Function Calling + 멀티턴 + Redis 세션 + 지출 파싱)
Week 13~14: 희소성 점수 알고리즘 + Hidden Gems 연동
```

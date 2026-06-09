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
│   │   ├── route_gen.py       # POST /ai/routes/generate
│   │   ├── reshuffle.py       # POST /ai/routes/reshuffle
│   │   ├── chatbot.py         # WebSocket /ai/chat
│   │   ├── embedding.py       # POST /ai/embeddings (내부용)
│   │   └── scoring.py         # POST /ai/places/rarity-score
│   │
│   ├── services/
│   │   ├── rag_service.py     # pgvector 검색
│   │   ├── tsp_service.py     # OR-Tools 동선 최적화
│   │   ├── model_router.py    # Haiku ↔ Sonnet 라우팅
│   │   ├── expense_parser.py  # 자연어 지출 파싱
│   │   └── rarity_scorer.py  # 희소성 점수 계산
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
| Pin & Reshuffle | Claude Haiku 4.5 | 단순 슬롯 재정렬 → 저비용 충분 |
| 챗봇 단순 질문 | Claude Haiku 4.5 | 빠른 응답 (현지 추천, 거리 안내 등) |
| 챗봇 복잡 플래닝 | Claude Sonnet 4.6 | 멀티턴 컨텍스트 + Function Calling |
| 예산 자연어 파싱 | Claude Haiku 4.5 | 금액·카테고리 추출 단순 작업 |
| 검색 쿼리 생성 | Claude Haiku 4.5 | 입력값 → 검색 키워드 변환 |

## AI 루트 생성 RAG 파이프라인

```python
# 전체 흐름

# 1. 검색 쿼리 생성 (Haiku)
search_keywords = await generate_search_keywords(user_input)
# 예: "부산 먹방 해산물", "부산 힐링 해변"

# 2. 장소 검색 (멀티소스 병렬)
candidates = await asyncio.gather(
    pgvector_similarity_search(keywords, limit=30),   # 의미 기반
    postgis_radius_search(destination, radius_km=20), # 위치 기반
    filter_by_tags(user_tags),                        # 태그 필터
    get_hidden_gems(include=user_input.include_hidden_gems),
)
# 후보 50~100개 수집

# 3. 필터링
filtered = filter_places(
    candidates,
    budget=user_input.total_budget,
    exclude_visited=user_visited_history,
    weather=current_weather,           # 우천 시 실외 하향
)
# 최종 후보 20~30개

# 4. 동선 최적화 (OR-Tools TSP)
optimized_slots = tsp_optimize(
    filtered,
    anchor_places=user_input.anchor_places,
    density=user_input.density,        # relaxed/normal/packed
)

# 5. 루트 생성 (Sonnet 4.6, 스트리밍)
route = await generate_route_with_llm(
    slots=optimized_slots,
    user_input=user_input,
    stream=True,                       # Day별 순차 스트리밍
)

# 6. 환각 방지 검증
validated_route = await validate_place_ids(route, db)
# LLM 출력 place_id를 실제 DB에서 재조회
# 존재하지 않는 ID → 유사 장소로 자동 교체
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
| Pin & Reshuffle | 2~3초 | Haiku + 부분 재계산 |
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
OPENAI_API_KEY=sk-...          # 임베딩 전용
POSTGRES_URL=postgresql://...
REDIS_URL=redis://...
GOOGLE_MAPS_API_KEY=...        # 좌표 검증용
```

## AI 기능 개발 권장 순서

```
Week 1~2:  FastAPI 뼈대 + Claude API 연결 + 모델 라우팅 설계
Week 3~4:  TourAPI + 카카오 로컬 API 수집기 + 데이터 파이프라인
Week 5~6:  pgvector 임베딩 → RAG 파이프라인 → 루트 생성 MVP
Week 7~8:  OR-Tools TSP 동선 최적화 + Pin & Reshuffle
Week 9~12: 챗봇 (Function Calling + 멀티턴 + Redis 세션 + 지출 파싱)
Week 13~14: 희소성 점수 알고리즘 + Hidden Gems 연동
```

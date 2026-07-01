# Cloumy AI 서비스

## 기술 스택
- Python 3.11, FastAPI 0.115, uvicorn
- Anthropic SDK (claude-sonnet-4-6 / claude-haiku-4-5-20251001)
- LangChain Core (BaseRetriever만 사용, 체인/에이전트 미사용)
- OpenAI SDK (text-embedding-3-small 임베딩)
- asyncpg + pgvector, Redis, OR-Tools (TSP 동선 최적화)

## 폴더 구조
- app/routes/ — FastAPI 라우터 (route_gen.py, slot_alternatives.py)
- app/services/ — 비즈니스 로직 (순수 함수 방식, 서비스 클래스 없음)
- app/config/ — settings.py (pydantic-settings), database.py, redis.py
- app/models/schemas.py — Pydantic 요청/응답 스키마

## 엔드포인트
- `POST /ai/routes/generate` — NDJSON 스트리밍 루트 생성
- `POST /ai/routes/slots/alternatives` — 대체 장소 3곳 추천
- `GET /health` — DB 연결 확인 (인증 불필요)

## 주요 패턴
- 모든 요청: `X-Internal-Key` 헤더 검증 미들웨어 (/health 제외)
- DB/Redis: `request.app.state.db`, `request.app.state.redis`로 접근 (FastAPI DI 미사용)
- LLM 클라이언트: 모듈 레벨 싱글턴 (`_anthropic`, `_openai`)
- 스트리밍: `StreamingResponse` + `media_type="application/x-ndjson"`
- Prompt Caching: 시스템 프롬프트에 `cache_control ephemeral` 설정 (비용 ~90% 절감)

## 모델 라우팅
- `claude-sonnet-4-6`: 루트 생성 (복잡한 JSON, 스트리밍)
- `claude-haiku-4-5-20251001`: 슬롯 대안 추천 (단발 응답, 저비용)

## 주의사항
- 장소 검색 폴백: PgvectorRetriever → PostgisTagRetriever (OpenAI 오류 시)
- 반경 30km → 0건이면 50km 자동 확장 후 재시도
- TSP: OR-Tools PATH_CHEAPEST_ARC, 3초 제한, 스트리밍 완료 후 실행
- GeneratorExit 처리: 클라이언트 연결 종료 시 `gen.aclose()` 명시 호출

## 실행
```bash
uvicorn app.main:app --reload --port 8000
pytest
```

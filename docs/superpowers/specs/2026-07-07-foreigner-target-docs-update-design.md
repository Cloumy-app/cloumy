# 타겟 전환(외국인 관광객) 반영 — docs/planning 문서 업데이트 설계

## 배경

2026-07-06 Cloumy는 타겟을 "한국인 국내 여행자"에서 "방한 외국인 관광객(미국·일본·중국·대만)"으로 전환했다 (`planning/milestones.md` Phase 2.5 참고). 참고 자료는 Notion 기획 문서(`https://app.notion.com/p/a9a3c69447de8308b8810195b47d90ca`) — 서비스 개요, 타겟 페르소나, MVP 범위, 로드맵&KPI 페이지.

i18n 인프라 + 챗봇 다국어 마이그레이션(코드)은 이미 1단계 완료됐지만, `docs/`와 `planning/`의 문서들은 대부분 여전히 옛 "국내 MVP → 한국인 해외 아웃바운드 피벗" 프레임을 담고 있다. `strategy.md`는 스스로를 "제품 방향의 단일 진실 공급원"이라 선언하고 있어 방치하면 이후 구현 작업이 낡은 방향을 참고하게 되는 위험이 있다.

## 범위

**포함**: `planning/`과 `docs/`, 3개 `spec.md`의 문서 내용 수정. 실제 코드/DB 마이그레이션은 포함하지 않는다 (예: `pass_type` enum 값은 문서만 갱신, 결제 기능 구현 시점에 실제 반영).

**제외**: Foreigner Friendly Score, 콘서트·이벤트 앵커, 카메라 챗봇, 취향 태그 재설계, 지도 내비 3-way 분기, 국제결제 연동 등 신규 기능의 실제 구현. 이 설계는 해당 기능들을 문서상 "계획" 섹션으로 명시하는 것까지만 다룬다.

**수정 원칙**: 이미 구현되어 검증된 기술적 결정(라우트 생성 알고리즘, 예산 관리 스코프 결정, 데이터 파이프라인 소스, Tmap 이동시간 처리 등)은 그대로 유지한다. 타겟 시장 변경으로 더 이상 맞지 않는 부분(페르소나, 포지셔닝, 가격·결제, 지도 내비 provider, KPI, 태그 체계)만 Notion 문서 기준으로 교체한다.

## 파일별 변경 사항

### A. `planning/`

**`strategy.md`** — 구조는 유지, 내용 전면 교체:
- 핵심 비전 문장 유지, "현지 큐레이터" 표현은 Notion의 UGC 크리에이터 생태계(재한 외국인/마이크로 인플루언서) 개념으로 조정
- 경쟁 포지셔닝: vs 트리플 → vs GOKO/KOIN/Creatrip (Notion 차별화 비교표 인용)
- 로드맵 구조 반전: "국내 MVP(Phase1) → 해외 피벗(Phase2, 아웃바운드)" → "방한 외국인 MVP(Phase1) → 다국어 UI 확장(Phase2) → B2B(Phase3)"
- 타겟 사용자: 국내 페르소나 3종 → Notion 4개국 메인 페르소나 + 세컨더리 5종
- 가격 전략: `domestic_day/3night`, `overseas_day/4night` → Standard $4.99 / Extended $7.99
- 연기된 기능(Hidden Gems), 데이터 전략 표는 기술적으로 안 바뀌므로 유지

**`priorities.md`** — 표 단위 부분 수정:
- P0: "소셜 로그인(카카오·구글·애플)" → 구글·애플 우선, 카카오 보류 표기 추가. "카카오맵 딥링크 내비" → "지도 내비 3-way 분기(Naver/Google/카카오T)" 계획으로 갱신. "트립 패스 결제(토스페이먼츠)" → "국제결제 검토(Stripe 등) — PG 미확정" 표기
- P1 신규 항목 추가: Foreigner Friendly Score, 콘서트·이벤트 앵커(Serper+KOPIS), 취향 태그 재설계(10종), 카메라 챗봇, 다국어 UI 전면화
- KPI 목표 표: Notion 로드맵 수치로 교체 (Phase1: MAU 3,000 / Trip Pass 전환율 ≥3% / 여행기간 내 DAU율 ≥60% / 챗봇 사용률 ≥40% / 루트 공유율 ≥15% / NPS ≥40)
- 트립 패스↔기능 접근 권한 표: `domestic_/overseas_` 구분 제거, Standard/Extended 기준으로 재작성

**`milestones.md`** — Phase 2.5 섹션은 그대로 유지 (이미 정확함). Phase 3 "결제+인증 완성" 섹션의 토스페이먼츠/카카오 로그인 항목에 ⚠️ 재검토 필요 플래그만 추가 보강.

### B. `docs/`

**`00-overview.md`** (가장 큰 수정):
- 페르소나 6개(한국인) 표 → Notion 4개국 메인 페르소나 요약 표 + 세컨더리 5종 언급
- 문제/시장 규모 → 방한 외국인 수치 (연 1,600만 명, K-content 동기 방한 41.8%, 국가별 방한 규모 등, Notion 페이지 인용)
- MVP 범위 "7가지 기능(국내 20개 도시)" → Notion MVP 10가지 기능 (도시 5개는 서울·부산·제주·경주·전주로 이미 일치, 유지)
- 기술스택 표: 카카오맵 딥링크 → 3-way 분기 계획, 토스페이먼츠 → "국제결제 검토 중(미확정)", 카카오 로그인 우선순위 하향, i18n 스택(i18next 등) 추가
- 비즈니스모델: 원화 트립패스 → Standard $4.99 / Extended $7.99
- KPI: WAR → Notion 북극성 지표("여행 기간 중 루트를 실제로 사용해 완료한 Trip Pass 유저 수")로 교체, Phase별 목표 수치 갱신

**`01-prd.md`**: 지도 내비 섹션 카카오맵→3-way 계획, 결제 섹션 토스→국제결제 TBD, 챗봇 섹션에 카메라 입력 "계획" 하위섹션 추가, Foreigner Friendly Score·콘서트 앵커·취향태그 재설계를 신규 "계획" 섹션으로 추가

**`02-architecture.md`**: 지도 관련 ADR — 카카오맵 딥링크 단일 → 3-way 분기로 수정. 결제 ADR-6 — 재검토 필요 플래그 + Stripe 등 후보 명시

**`03-data-model.md`**: `pass_type` enum 문서를 `domestic_day`~`overseas_4night` → `standard`/`extended`로 갱신, 각주로 "결제 기능 구현 시 실제 마이그레이션 반영 예정" 명시 (DB 변경 없음)

**`04-api-spec.md`**: 결제 API 예시의 토스페이먼츠 표기를 국제결제 후보로 대체(TBD 명시), 챗봇 API에 이미 구현된 `language` 필드 반영

**`05-ai-service-architecture.md` / `06-ai-chatbot.md`**: 이미 구현된 다국어 시스템 프롬프트 내용 반영, 카메라 입력(메뉴판/키오스크 번역) "계획" 섹션 추가

### C. `spec.md` 3개 + `planning/reference/`

**`frontend/spec.md`**: 결제 섹션(토스페이먼츠 웹뷰 → 국제결제 검토 중, 미확정), 딥링크 섹션(카카오맵 단일 → 3-way 계획), i18n 스택(i18next) 반영

**`backend/spec.md`**: 결제 플로우 섹션에 "토스페이먼츠는 국내 전용 PG — 외국인 타겟과 안 맞아 재검토 필요" 각주, 검증 로직은 PG 선택 전까지 보류 표기

**`ai/spec.md`**: 챗봇 다국어 응답(이미 구현) 반영, 카메라 입력 처리 파이프라인 "계획" 섹션 추가

**`planning/reference/data-sources.md`**: Serper API(콘서트·이벤트 검색), KOPIS 연동 계획 추가

**`dev-flow.md`, `infrastructure.md`**: 국내 전용 가정 없음 확인됨 — 수정 불필요

## 작업 순서

문서 간 참조 관계상 아래 순서로 진행하는 게 안전하다 (뒷 문서가 앞 문서의 결정을 인용하는 구조):

1. `planning/strategy.md` (단일 진실 공급원 — 가장 먼저)
2. `planning/priorities.md`, `planning/milestones.md` 보강
3. `docs/00-overview.md`
4. `docs/01-prd.md` → `02-architecture.md` → `03-data-model.md` → `04-api-spec.md`
5. `docs/05-ai-service-architecture.md`, `06-ai-chatbot.md`
6. `frontend/spec.md`, `backend/spec.md`, `ai/spec.md`
7. `planning/reference/data-sources.md`

## 검증 방법

코드 변경이 없는 순수 문서 작업이므로 자동화된 테스트는 없다. 완료 기준:
- 각 파일에서 "카카오맵 단독", "토스페이먼츠 확정", "한국인 국내 여행자 타겟", "해외 피벗(아웃바운드)" 등 옛 프레임 표현이 grep으로 더 이상 검출되지 않음
- 신규 "계획" 섹션(Foreigner Friendly Score, 콘서트 앵커, 카메라 챗봇, 태그 재설계, 3-way 지도 내비, 국제결제)이 최소 1곳 이상에 명시됨
- 이미 구현된 기술적 결정(라우트 생성, 예산 관리, 데이터 파이프라인) 관련 서술이 삭제되지 않고 보존됨

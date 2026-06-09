# 백엔드 구현 가이드

## 기술 스택

| 구성 요소 | 기술 | 버전 |
|-----------|------|------|
| 언어 | Java | 21 (LTS) |
| 프레임워크 | Spring Boot | 3.x |
| ORM | Spring Data JPA + QueryDSL | - |
| API Gateway | Spring Cloud Gateway | - |
| 보안 | Spring Security + JWT | - |
| 지리 | PostGIS (PostgreSQL 확장) | - |
| 캐시 | Spring Data Redis | - |
| 비동기 | Spring @Async (MVP) → Kafka (Phase 2) | - |
| 결제 | 토스페이먼츠 SDK | - |
| 파일 | AWS S3 SDK | - |
| 푸시 | Firebase Admin SDK (FCM) | - |
| 빌드 | Gradle | - |

## 서비스 레이어 구조

### MVP 초반 (모놀리식)

```
com.cloumy/
├── auth/
│   ├── AuthController.java
│   ├── AuthService.java
│   ├── OAuthService.java          # 카카오/구글/애플 OAuth 처리
│   ├── JwtProvider.java
│   └── dto/
│
├── trip/
│   ├── RouteController.java
│   ├── RouteService.java
│   ├── SlotService.java
│   ├── PlaceQueryService.java      # 장소 검색 (PostGIS)
│   └── dto/
│
├── community/
│   ├── HiddenGemController.java
│   ├── HiddenGemService.java
│   ├── TagSearchService.java
│   └── dto/
│
├── budget/
│   ├── BudgetController.java
│   ├── BudgetService.java
│   ├── ExpenseService.java
│   └── dto/
│
├── payment/
│   ├── PaymentController.java
│   ├── TossPaymentsService.java    # 결제 검증
│   ├── PassService.java           # 트립 패스 활성화
│   └── dto/
│
├── group/
│   ├── GroupTripController.java
│   ├── GroupTripService.java
│   ├── GroupWebSocketHandler.java  # 실시간 동기화
│   └── dto/
│
├── notification/
│   ├── FcmService.java
│   └── NotificationScheduler.java
│
└── common/
    ├── exception/                  # 글로벌 예외 처리
    ├── config/                     # Security, Redis, S3 설정
    ├── util/                       # JWT, GeoUtils
    └── entity/                     # BaseEntity (createdAt 등)
```

## 핵심 비즈니스 로직 흐름

### 1. AI 루트 생성 요청 처리

```
[클라이언트] POST /routes/generate
    ↓
[RouteController] 요청 유효성 검사 + 트립 패스 권한 확인
    ↓
[RouteService]
  1. 루트 Draft 생성 → DB 저장 (routeId 즉시 반환)
  2. FastAPI AI 서비스에 HTTP 요청 (비동기)
  3. SSE/WebSocket으로 스트리밍 응답 클라이언트 전달
    ↓
[AI 서비스 응답 수신]
  route_slots 테이블 bulk insert
  Redis에 루트 캐시 저장 (TTL 1시간)
```

### 2. Pin & Reshuffle

```
[클라이언트] POST /routes/{routeId}/slots/{slotId}/reshuffle
    ↓
[SlotService]
  1. 고정된 슬롯 ID 목록 조회
  2. FastAPI에 "고정 슬롯 + 해당 슬롯 제외" 조건으로 재추천 요청
  3. 대안 3개 반환
    ↓
[클라이언트] 대안 선택 시 → PATCH /routes/{routeId}/slots/{slotId}
  1. route_slots 업데이트
  2. Redis 캐시 무효화
```

### 3. 결제 플로우 (토스페이먼츠)

```
[클라이언트] POST /payments/trips → orderId, amount 반환
    ↓
[클라이언트] 토스페이먼츠 웹뷰에서 결제 진행
    ↓
[클라이언트] 결제 완료 → POST /payments/trips/confirm (paymentKey 포함)
    ↓
[TossPaymentsService]
  1. 토스페이먼츠 서버에 결제 검증 API 호출 (서버 사이드 필수)
  2. 검증 성공 → payments 테이블 저장
  3. users.pass_type, pass_expires_at 업데이트
  4. FCM 결제 완료 알림 발송
```

### 4. Hidden Gem GPS 인증

```
[클라이언트] POST /places/hidden-gems (사진 + GPS 좌표 포함)
    ↓
[HiddenGemService]
  1. 서버에서 클라이언트 GPS 좌표 검증
     - 등록하려는 장소 좌표와 클라이언트 좌표 거리 계산 (PostGIS)
     - 100m 이내 → 인증 통과 / 초과 → 인증 실패 (400)
  2. S3에 사진 업로드
  3. 희소성 점수 계산 (FastAPI 요청)
     - 희소성 80+ → is_hidden_gem = true, 🔮 배지 부여
  4. places 테이블 저장
  5. @Async로 pgvector 임베딩 생성 (AI 서비스)
```

### 5. 그룹 여행 실시간 동기화

```
[WebSocket 연결]
  ws://api.cloumy.app/v1/group/{groupTripId}
  연결 시 Redis에 세션 등록
    ↓
[슬롯 투표 메시지 수신]
  1. route_slots 테이블 업데이트
  2. Redis Pub/Sub → 같은 그룹 모든 연결에 브로드캐스트
    ↓
[연결 해제 시]
  Redis 세션 정리
```

## 외부 서비스 연동

| 서비스 | 용도 | 호출 방식 |
|--------|------|----------|
| FastAPI AI 서비스 | 루트 생성, 챗봇, Pin&Reshuffle, 지출 파싱 | HTTP (내부망) |
| 카카오 OAuth | 소셜 로그인 | HTTP |
| 구글 OAuth | 소셜 로그인 | HTTP |
| TourAPI | 장소 DB 수집 (배치, 1일 1회) | HTTP + Spring @Scheduled |
| 카카오 로컬 API | 장소 DB 보강 (배치, 3일 1회) | HTTP + Spring @Scheduled |
| 토스페이먼츠 | 결제 검증 | HTTP |
| AWS S3 | 이미지 업로드 | AWS SDK |
| FCM | 푸시 알림 | Firebase Admin SDK |
| 기상청 API | 여행 중 날씨 (챗봇 연동) | HTTP |

## 보안 고려사항

| 위협 | 대응 |
|------|------|
| JWT 탈취 | Refresh Token Redis 저장, 로그아웃 시 블랙리스트 등록, Access Token 1시간 만료 |
| LLM 프롬프트 인젝션 | 사용자 입력 sanitize, 시스템 프롬프트 분리 |
| API 과호출 | Spring Cloud Gateway Rate Limiting (사용자별 분당 제한) |
| Hidden Gems GPS 위조 | 서버 사이드 PostGIS 거리 검증, 반경 100m 이내만 인정 |
| 결제 위변조 | 토스페이먼츠 서버 사이드 검증 필수 (클라이언트 단독 신뢰 금지) |
| 위치 정보 | GPS 좌표 DB 저장 시 AES-256 암호화 |
| 결제 정보 | 카드번호 등 원본 미저장 (토스페이먼츠 서버에만 존재) |
| 여행 이력 조회 | Row-level Security (본인만 조회 가능) |

## 데이터 수집 배치 (Spring @Scheduled)

```java
// TourAPI 수집 — 매일 새벽 2시
@Scheduled(cron = "0 0 2 * * *")
public void collectTourApiPlaces() { ... }

// 카카오 로컬 API 수집 — 3일마다 새벽 3시
@Scheduled(cron = "0 0 3 */3 * *")
public void collectKakaoLocalPlaces() { ... }

// Hidden Gems 희소성 점수 재계산 — 매일 새벽 4시
@Scheduled(cron = "0 0 4 * * *")
public void recalculateRarityScores() { ... }
```

## 환경별 설정

```yaml
# application-dev.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/cloumy_dev
  redis:
    host: localhost
    port: 6379

# application-prod.yml
spring:
  datasource:
    url: jdbc:postgresql://${RDS_ENDPOINT}:5432/cloumy
  redis:
    host: ${ELASTICACHE_ENDPOINT}
```

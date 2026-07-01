# Cloumy Backend

## 기술 스택
- Java 21 (Virtual Threads), Spring Boot 3.3.5
- Spring Security + JJWT 0.12.x (Access/Refresh 토큰)
- Spring Data JPA + QueryDSL 5.1.0 (Jakarta)
- PostgreSQL + PostGIS + pgvector, Flyway 마이그레이션
- Redis (JWT 블랙리스트, 루트 캐시)

## 패키지 구조
- com.cloumy.auth/ — 인증, OAuth (Kakao/Google/Apple/Naver), JWT
- com.cloumy.trip/ — 루트·슬롯·장소 도메인
- com.cloumy.payment/ — 패스 검증
- com.cloumy.common/ — ApiResponse, BusinessException, BaseEntity

## 코딩 패턴
- Controller: `@RestController`, 반환 타입 항상 `ApiResponse<T>`
- 인증 필요 시: `@AuthenticationPrincipal CloudmyUserDetails user`로 userId 추출
- Service: 클래스 레벨 `@Transactional(readOnly = true)`, 쓰기 메서드만 `@Transactional`
- 예외: `throw new BusinessException(ErrorCode.XXX)` 형식으로 일원화
- Entity PK: UUID 타입, `@GeneratedValue(strategy = GenerationType.UUID)`
- Entity 생성: `@NoArgsConstructor(access = PROTECTED)` + 정적 팩토리 or `@Builder`

## 주의사항
- SSE 스트리밍: Java 21 Virtual Thread + SseEmitter, FastAPI는 HTTP_1_1만 지원
- JWT: `type` claim으로 access/refresh 구분, 로그아웃 시 JTI를 Redis 블랙리스트 등록
- dev 프로필: localhost:5433 DB, DevAuthController 활성화 (OAuth 없이 토큰 발급)
- 슬롯 저장: `Propagation.REQUIRES_NEW`로 슬롯별 독립 트랜잭션

## 실행
```bash
./gradlew bootRun --args='--spring.profiles.active=dev'
./gradlew test
```

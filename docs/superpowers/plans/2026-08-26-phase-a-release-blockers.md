# Phase A — 출시 차단 요소 4건

> **스택**: Spring · DB · Frontend
> **참조 전문가 스킬**: `spring-expert` · `postgres-expert` · `frontend-expert` · `karpathy-guidelines`
> **노션**: [🚀 출시 최소범위 마무리](https://app.notion.com/p/3c83c69447de811aab85ddc189ee7609)
> **상위 계획**: `planning/milestones.md` 「🚀 출시 최소범위 마무리」

모두의 창업 탈락으로 자금 전제 기능을 전부 접고 출시 최소범위만 진행한다.
Phase A는 **출시 자체를 막는 4건**이고, 서로 의존이 없어 병렬로 진행할 수 있다.

> ⚠️ **스킬 문서 오차 주의** — `postgres-expert`/`spring-expert`가 "현재 V5, 다음은 V6"라고 적고 있으나
> **실제는 V21까지 적용돼 있고 다음은 V22**다. `frontend-expert`는 Tamagui·`store/`·`services/`를 말하지만
> 실제 코드는 NativeWind className · `stores/` · `lib/api/`다. **실제 코드 스타일을 따른다.**

---

## 전제 조건

- `docker-compose up -d` — PostgreSQL(⚠️ 포트 5433으로 임시 변경됨) · Redis
- A-4만 **사용자 선행 작업**에 막혀 있다 — Google Cloud Console OAuth 클라이언트 ID 발급
- A-1·A-2·A-3은 선행 조건 없음

---

## 실패 시나리오 (FFE Step 1 & 2)

| # | 실패 상황 | 감지 방법 | 대응 방안 |
|---|---|---|---|
| 1 | V22가 기존 데이터와 충돌 (`budget_level`에 5종 밖의 값이 이미 있음) | 마이그레이션 실행 시 `check constraint violated` | **적용 전 `SELECT DISTINCT budget_level FROM routes` 로 확인.** 기존 값은 3종뿐이므로 5종은 진부분집합 확장 → 충돌 불가. 확인 없이 진행 금지 |
| 2 | 제약 이름이 `routes_budget_level_check`가 아님 | `DROP CONSTRAINT` 실패 | `DROP CONSTRAINT IF EXISTS` + 마이그레이션 후 `\d routes`로 재확인. V3가 컬럼 레벨 인라인 CHECK라 PostgreSQL 기본 명명 규칙 `{table}_{column}_check`가 적용됨 |
| 3 | `@Pattern` 추가로 기존 클라이언트가 400을 맞음 | 루트 생성 400 급증 | `RouteService.java:88-91`이 `.toLowerCase()`를 하고 있어 대문자 입력을 허용해 왔다. **`(?i)` 플래그로 대소문자 무시** — 검증만 추가하고 허용 범위는 안 좁힌다 |
| 4 | Apple 분기 제거 후 부팅 실패 | `ApplicationContext` 로드 실패 | `AppProperties.OAuth` record에서 `apple` 필드를 빼면 `application.yml`의 `app.oauth.apple.*`은 **바인딩되지 않을 뿐 에러는 아니다**(unknown property 무시). 그래도 yml에서 같이 지운다 |
| 5 | Redis fail-open이 블랙리스트를 무력화 | — | **의도된 트레이드오프.** 블랙리스트는 로그아웃된 소수 토큰 차단용 부가 기능인데 지금은 앱 전체 가용성이 여기 종속돼 있다. `RateLimitFilter.java:80-84`가 같은 판단을 이미 프로젝트 정책으로 선언해 뒀다 |
| 6 | 구글 OAuth 리디렉트가 앱으로 안 돌아옴 | 브라우저가 열린 채 멈춤 | `app.json`의 `scheme: "cloumy"`를 `makeRedirectUri`에 사용. Google Cloud Console의 승인된 리디렉션 URI와 **정확히 일치**해야 함 |
| 7 | 구글 access token은 받았는데 서버가 거부 | `POST /v1/auth/social` 4xx | `GoogleOAuthClient.java:24-42`는 **access token**으로 `/oauth2/v2/userinfo`를 부른다. `idToken`이 아니라 **`accessToken`을 보내야 한다** — 헷갈리기 쉬운 지점 |
| 8 | 사용자가 구글 동의창을 취소 | `promptAsync()` 결과 `type !== 'success'` | Alert 없이 조용히 복귀 (취소는 에러가 아님). 네트워크 실패만 Alert |

---

## A-1. budget_level CHECK 5종 확장 + 요청 값 검증 3종

### 왜 필요한가

사용자가 고를 수 있는 선택지가 서비스를 깨뜨린다. 앱은 5종, AI도 5종인데 **DB만 3종**이라
「초절약」(`tight`)·「특별하게」(`luxury`)를 고르면 `RouteController.java:224`의 `createRoute()`에서
INSERT가 CHECK 위반 → **SSE를 열기도 전에 500**.

### Step 1 — 먼저 재현한다 (고치기 전)

```bash
psql -h localhost -p 5433 -U cloumy -d cloumy -c \
  "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'routes'::regclass AND conname LIKE '%budget%';"
# 기대: routes_budget_level_check | CHECK (budget_level::text = ANY (ARRAY['budget','mid','premium']))

psql ... -c "SELECT DISTINCT budget_level FROM routes;"
# 기대: budget/mid/premium 중 일부만 — 5종 밖의 값이 있으면 마이그레이션 중단하고 먼저 정리
```

그다음 앱에서 「초절약」으로 루트 생성 → 500 확인. **정적 대조로 찾은 결함이라 실행 확인이 필요하다.**

### Step 2 — `V22__fix_routes_budget_level_check.sql`

```sql
-- ============================================================
-- V22: routes.budget_level CHECK를 5종으로 확장
-- ============================================================
-- 왜: 앱(step-2.tsx)과 AI(schemas.py)는 5단계로 나가 있는데 V3의 CHECK만 3종에 멈춰 있다.
--     tight/luxury를 고르면 INSERT가 제약 위반으로 죽어 루트 생성이 500이 된다.
--     앱이 이미 5단계 UX로 출시돼 있으므로 DB를 앱에 맞추는 방향으로 고친다.
-- ============================================================
BEGIN;

ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_budget_level_check;
ALTER TABLE routes ADD CONSTRAINT routes_budget_level_check
    CHECK (budget_level IN ('tight', 'budget', 'mid', 'premium', 'luxury'));

COMMIT;
```

**주의**: 기존 3종은 새 5종의 진부분집합이라 데이터 마이그레이션이 필요 없다. `NOT VALID` 불필요.

### Step 3 — `RouteGenRequest.java` 값 검증

```java
        @NotBlank
        @Pattern(regexp = "(?i)(solo|couple|friends|family)")
        String groupType,

        @NotBlank
        @Pattern(regexp = "(?i)(tight|budget|mid|premium|luxury)")
        String budgetLevel,
        ...
        // null이면 RouteService가 "normal"로 채운다 — @Pattern은 null을 통과시키므로 그대로 둔다
        @Pattern(regexp = "(?i)(relaxed|normal|packed)")
        String density,
```

**왜 이 방식인가** — `@Pattern` 인라인이 이 프로젝트의 지배적 관례다
(`AddExpenseRequest.java:9`, `AccommodationCreateRequest.java:16`, `ExternalPlaceRequest.java:12`).
`ProactiveIntervention.TYPE_PATTERN`처럼 상수로 뽑는 건 **3개 DTO가 공유할 때**의 얘기고,
여기는 소비처가 `RouteGenRequest` 하나뿐이라 상수 추출은 불필요한 추상화다.
커스텀 `ConstraintValidator`는 프로젝트에 0건이라 새로 만들지 않는다.

**`(?i)` 를 붙이는 이유** — `RouteService.java:88-91`이 `.toLowerCase()`로 대문자 입력을
받아주고 있었다. 검증을 추가하면서 허용 범위를 좁히면 그게 새 회귀다.

### 범위 밖 (의도적)

CHECK 컬럼 12종을 3계층 대조한 결과 **실제 위반은 `budget_level` 하나뿐**이다.
- `routes.transport_mode` — `Route` 엔티티에 필드가 없는 **데드 컬럼**, 아무도 write 안 함
- `frontend/types/index.ts:182` `PassType` — DB(`none/day/3night/4night`)와 어휘가 다른 **데드 타입**,
  프론트 로컬 상태 전용이고 서버로 안 보냄

둘 다 체감 버그가 없어 이번엔 건드리지 않는다.

---

## A-2. Apple 로그인 분기 제거

### 왜 검증 구현이 아니라 제거인가

`AppleOAuthClient.java:31`이 JWT의 **payload만** Base64 디코드하고 헤더·서명을 버린다.
`parts.length != 3` 체크가 유일한 관문이라 `a.{조작한payload}.b` 형태만 맞추면
**임의 apple `sub` 계정을 생성·탈취**할 수 있다. 신규 생성 시 `AuthService.java:58`
`grantDayPass()`까지 타준다. `iss`·`aud`·`exp`·`nonce` 전부 미검증.

그런데 고쳐서 쓸 수가 없다:
- 애플 개발자 계정이 없어 `APPLE_CLIENT_ID`가 빈 값(`application.yml:66`) → `aud` 검증을 끝까지 확인 불가
- 프론트에 애플 버튼이 없다 (`grep -i apple frontend/` → 0건)
- `AppProperties.Apple`은 어디서도 안 읽히는 죽은 설정

**쓰지 않는 코드에 취약점이 있으면 지우는 게 고치는 것보다 낫다.**

### 변경 목록 (전수 grep 기준)

| 파일 | 작업 |
|---|---|
| `auth/service/AuthService.java:8, 38, 106` | import · 필드 · `case "apple"` 제거 |
| `auth/oauth/AppleOAuthClient.java` | 파일 삭제 |
| `auth/dto/SocialLoginRequest.java:6` | 주석에서 `"apple"` 제거, `// 애플은 identity token(JWT) 전달` 주석도 삭제 |
| `common/config/AppProperties.java:45, 57-62` | `OAuth` record의 `Apple apple` 필드 + `Apple` record 제거 |
| `resources/application.yml:65-69` | `app.oauth.apple.*` 5줄 제거 |
| `.env.example:36-40` | `APPLE_*` 4종 + 안내 주석 제거 |

---

## A-3. JWT 블랙리스트 Redis 장애 fail-open

### 왜 필요한가

`JwtTokenProvider.java:84`의 `redisTemplate.hasKey(...)`가 try-catch **밖**에 있다.
Redis가 죽으면 `RedisConnectionFailureException`(unchecked)이 그대로 튀어나가는데
`JwtAuthenticationFilter.java:50-55`는 `BusinessException` **하나만** 잡고,
`GlobalExceptionHandler`는 `@RestControllerAdvice`라 필터 단계 예외를 못 잡는다.

→ **모든 인증 요청이 500. Redis 하나로 앱 전면 장애.**
블랙리스트는 로그아웃된 소수 토큰을 막는 부가 기능인데 가용성이 여기에 종속돼 있다.

### 구현

```java
        // 로그아웃 처리된 토큰 차단 — Redis 장애 시 fail-open.
        // RateLimitFilter와 같은 정책이다: 부가 기능(블랙리스트) 때문에 인증 전체가
        // 막히면 안 된다. 로그아웃된 토큰이 만료 전까지 살아남는 위험보다 전면 장애가 크다.
        try {
            if (Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_KEY_PREFIX + claims.getId()))) {
                throw new BusinessException(ErrorCode.JWT_REVOKED);
            }
        } catch (BusinessException e) {
            throw e;                                  // ← JWT_REVOKED는 그대로 올려보낸다
        } catch (Exception e) {
            log.warn("JWT 블랙리스트 조회 실패 — 통과 처리: {}", e.getMessage());
        }
```

**⚠️ 가장 빠뜨리기 쉬운 지점**: `catch (Exception e)`가 **`BusinessException`도 삼킨다.**
`JWT_REVOKED`를 던지는 `throw`가 try 블록 안에 있으므로 `catch (BusinessException e) { throw e; }`를
먼저 두지 않으면 **블랙리스트가 통째로 무력화된다.** (`RateLimitFilter`는 try 안에서 예외를 던지지
않아 이 문제가 없었다 — 패턴을 그대로 복사하면 안 되는 이유.)

### ⚠️ 실측으로 드러난 추가 작업 — Redis 타임아웃 (2026-08-26)

try-catch만으로는 **목적을 달성하지 못한다.** 실제로 Redis를 내리고 측정하니
fail-open은 동작하지만 **60.14초 걸렸다** — Lettuce 기본 커맨드 타임아웃이 60초인데
`application.yml`에 타임아웃 설정이 아예 없었다.

```
JWT 블랙리스트 조회 실패 — 통과 처리: Redis command timed out
HTTP 200   소요 60.140549초
```

모든 인증 요청이 1분씩 매달리는 건 500과 다를 바 없는 전면 장애다.

```yaml
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      timeout: 1s
      connect-timeout: 1s
```

**측정 결과: 60.14초 → 1.03초.** Redis 정상 시 블랙리스트 차단은 그대로 동작한다(401 TOKEN_REVOKED 확인).
이 설정은 `RateLimitFilter`·`AiServiceClient`의 fail-open에도 똑같이 적용된다 — 셋 다 같은 병을 앓고 있었다.

### 범위 밖

`revokeToken`(`:91-100`)의 `opsForValue().set(...)`도 무방비지만 **컨트롤러 레이어라 500으로 정상 처리**된다.
로그아웃이 실패했는데 성공했다고 응답하는 게 더 나쁘다. 손대지 않는다.

---

## A-4. 구글 로그인 실구현

### 왜 필요한가

`login.tsx:48-53`의 구글 버튼이 `Alert.alert(t('login.comingSoonTitle'), ...)` — "준비 중" 안내만 띄운다.
동작하는 건 `__DEV__` 가드 안의 개발자 로그인(`:56-68`)뿐이라 **릴리즈 빌드에선 아무도 로그인을 못 한다.**

### 백엔드는 이미 완성돼 있다

`GoogleOAuthClient.java:24-42`가 access token으로 `/oauth2/v2/userinfo`를 부르고,
`POST /v1/auth/social`(`AuthController.java:27`)이 `SocialLoginRequest{provider, oauthAccessToken}`을
받아 계정 생성·매칭까지 한다. **프론트만 붙이면 된다.**

### Step 1 — 의존성

```bash
cd frontend && npx expo install expo-auth-session expo-web-browser expo-crypto
```

### Step 2 — `lib/api/auth.ts`

기존 `devLogin`(`:12-23`)과 **같은 형태**로 추가한다 — `AbortController` 타임아웃,
`res.ok` 검사 후 `throw new Error(String(res.status))`, `body.data` 언랩.

```typescript
export async function socialLogin(
  provider: 'google',
  oauthAccessToken: string,
): Promise<DevLoginResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/v1/auth/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, oauthAccessToken }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const body: { data: DevLoginResponse } = await res.json();
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
```

> `DevLoginResponse`는 이름만 dev일 뿐 `/v1/auth/social` 응답과 동형이다.
> **`AuthTokenResponse`로 rename하고 두 함수가 공유**한다 (타입 중복 생성 금지).

### Step 3 — `app/(auth)/login.tsx`

```typescript
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();   // 모듈 최상단 — 컴포넌트 안 아님

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;         // 취소는 조용히 무시
    const token = response.authentication?.accessToken;
    if (!token) return;
    handleSocialLogin(token);
  }, [response]);
```

`handleSocialLogin`은 `handleDevLogin`(`:16-33`)의 성공 처리와 에러 Alert 분기를 그대로 재사용한다:
`setTokens` → `setUser` → `router.replace(user.onboardingCompleted ? '/(tabs)' : '/(auth)/onboarding')`.

**버튼**: `onPress={() => promptAsync()}`, `disabled={!request || loading}`.
i18n `login.googleComingSoonBody` 키는 4개 언어 모두에서 제거한다.

### Step 4 — 환경 변수

`.env.example`에 `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `_ANDROID_` / `_WEB_` 3종 추가.
`EXPO_PUBLIC_` 접두사가 있어야 클라이언트에 노출된다.

### ⚠️ 사용자 선행 작업

1. Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID **3종**(iOS / Android / 웹)
2. **번들 ID가 `com.anonymous.cloumy`(Expo 기본 placeholder)로 남아 있다** (`app.json:11`).
   실제 스토어 출시 전에 바꿔야 하는데, 구글 iOS 클라이언트를 이 값으로 발급하면 **나중에 재발급**해야 한다.
   → **번들 ID를 먼저 확정하고 키를 발급하는 게 맞다**

---

## 검증 방법

```bash
# A-1 ── 마이그레이션 적용
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
# 기대: Flyway "Migrating schema public to version 22 - fix routes budget level check"

psql -h localhost -p 5433 -U cloumy -d cloumy -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='routes_budget_level_check';"
# 기대: CHECK (... ANY (ARRAY['tight','budget','mid','premium','luxury']))

# A-1 ── 400 vs 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/v1/routes/generate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"destination":"서울","startDate":"2026-09-01","endDate":"2026-09-03",
       "groupType":"solo","budgetLevel":"ultra_luxury"}'
# 기대: 422  (수정 전에는 500)
#   ※ GlobalExceptionHandler:35가 MethodArgumentNotValidException을
#      UNPROCESSABLE_ENTITY로 응답한다 — 400이 아니다(계획 초안의 오기)

# A-2 ── apple 분기 제거 확인
curl -s -X POST localhost:8080/v1/auth/social -H 'Content-Type: application/json' \
  -d '{"provider":"apple","oauthAccessToken":"a.eyJzdWIiOiJoYWNrZXIifQ.b"}'
# 기대: "지원하지 않는 소셜 로그인입니다: apple"  (수정 전에는 계정이 생성됨)
grep -rni apple backend/src/main || echo "apple 참조 0건 — OK"

# A-3 ── Redis fail-open
docker stop $(docker ps -qf name=redis)
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/v1/routes -H "Authorization: Bearer $TOKEN"
# 기대: 200  (수정 전에는 500)
docker start $(docker ps -aqf name=redis)
# Redis 복구 후 로그아웃한 토큰이 다시 차단되는지도 확인

# A-4 ── 릴리즈 모드 로그인
cd frontend && npx expo run:ios --configuration Release
# 기대: 개발자 로그인 버튼이 안 보이는 상태에서 구글 버튼만으로 로그인 성공
```

---

## 체크리스트

**A-1**
- [ ] 수정 전 `tight`로 500 재현 확인
- [ ] `SELECT DISTINCT budget_level` 로 기존 데이터가 3종뿐인지 확인
- [ ] V22 적용 후 5단계 전부 정상 생성
- [ ] 잘못된 값을 API로 직접 던지면 500이 아니라 422
- [ ] 대문자(`MID`)도 여전히 통과 — 회귀 없음
- [ ] 컨트롤러 422 응답 테스트 1개 추가 (백엔드에 관련 테스트가 전무함)

**A-2**
- [ ] `grep -rni apple backend/src/main` → 0건
- [ ] `provider=apple` 직접 요청 시 계정이 생기지 않는다
- [ ] google/kakao/naver 경로 정상
- [ ] 부팅 정상

**A-3**
- [ ] `catch (BusinessException e) { throw e; }` 가 `catch (Exception e)` **앞**에 있다
- [ ] Redis 중지 상태에서 인증 요청 200
- [ ] Redis 복구 후 로그아웃 토큰 차단 여전히 동작
- [ ] `log.warn` 문구가 `RateLimitFilter`와 일관
- [ ] **Redis 중지 시 응답이 1초대** (타임아웃 설정 없으면 60초 — try-catch만으론 부족하다)

**A-4**
- [ ] Google OAuth 클라이언트 ID 3종 발급 (번들 ID 확정 후)
- [ ] 릴리즈 빌드에서 구글 로그인 성공
- [ ] 신규 유저 → 온보딩, 기존 유저 → 탭
- [ ] 동의창 취소 시 Alert 안 뜸 / 네트워크 실패는 Alert
- [ ] `login.googleComingSoonBody` 키 4개 언어에서 제거
- [ ] `DevLoginResponse` → `AuthTokenResponse` rename 후 두 함수 공유

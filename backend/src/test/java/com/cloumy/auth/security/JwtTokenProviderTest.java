package com.cloumy.auth.security;

import com.cloumy.common.config.AppProperties;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.io.Encoders;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.core.StringRedisTemplate;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JwtTokenProviderTest {

    // HS256에 충분한 길이(32바이트 이상)의 BASE64URL 문자열 — Decoders.BASE64URL로 디코딩되므로
    // 일반 문자열이 아니라 반드시 base64url 인코딩된 값이어야 한다.
    private static final String SECRET =
            Encoders.BASE64URL.encode("test-jwt-secret-key-for-unit-test-32bytes+".getBytes(StandardCharsets.UTF_8));

    @Mock
    private AppProperties appProperties;

    @Mock
    private StringRedisTemplate redisTemplate;

    @InjectMocks
    private JwtTokenProvider jwtTokenProvider;

    private SecretKey testKey;

    @BeforeEach
    void setUp() {
        // @PostConstruct는 스프링 컨텍스트 없이는 자동 호출되지 않으므로 직접 호출해 secretKey를 채운다
        when(appProperties.getJwt()).thenReturn(new AppProperties.Jwt(SECRET, 3600L, 604800L));
        jwtTokenProvider.init();
        testKey = Keys.hmacShaKeyFor(Decoders.BASE64URL.decode(SECRET));
    }

    private String expiredToken() {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject("user-expired")
                .id(UUID.randomUUID().toString())
                .claim("type", "access")
                .issuedAt(Date.from(now.minusSeconds(7200)))
                .expiration(Date.from(now.minusSeconds(3600)))
                .signWith(testKey)
                .compact();
    }

    private String wrongSignatureToken() {
        SecretKey otherKey = Keys.hmacShaKeyFor(
                Decoders.BASE64URL.decode(Encoders.BASE64URL.encode(
                        "completely-different-secret-key-32bytes!!".getBytes(StandardCharsets.UTF_8))));
        return Jwts.builder()
                .subject("user-wrong-sig")
                .id(UUID.randomUUID().toString())
                .claim("type", "access")
                .issuedAt(new Date())
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(otherKey)
                .compact();
    }

    @Test
    void validTokenReturnsClaimsWithSubject() {
        // 정상 토큰이면 파싱한 Claims의 subject가 그대로 나와야 한다
        String token = jwtTokenProvider.generateAccessToken("user-123", "USER");
        when(redisTemplate.hasKey(anyString())).thenReturn(false);

        Claims claims = jwtTokenProvider.validateToken(token);

        assertThat(claims.getSubject()).isEqualTo("user-123");
    }

    @Test
    void expiredTokenThrowsJwtExpired() {
        // 만료된 토큰은 Redis 조회 전에 파싱 단계에서 걸러져야 한다
        assertThatThrownBy(() -> jwtTokenProvider.validateToken(expiredToken()))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.JWT_EXPIRED));
    }

    @Test
    void wrongSignatureTokenThrowsJwtInvalid() {
        // 다른 키로 서명된 토큰은 서명 검증에서 걸러져야 한다
        assertThatThrownBy(() -> jwtTokenProvider.validateToken(wrongSignatureToken()))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.JWT_INVALID));
    }

    @Test
    void blacklistedTokenThrowsJwtRevoked() {
        // 회귀 방지 핵심(1/2): Redis가 정상일 때 블랙리스트에 등록된 토큰은 반드시 차단되어야 한다.
        //
        // validateToken은 블랙리스트 조회를 try-catch로 감싸 fail-open 한다. 그런데 JWT_REVOKED를
        // 던지는 throw가 try 블록 **안**에 있어서, `catch (BusinessException e) { throw e; }`를
        // 빼먹고 `catch (Exception e) { log.warn }`만 두면 JWT_REVOKED가 조용히 삼켜진다 —
        // 로그아웃한 토큰이 계속 통과하는데 겉으로는 아무 증상이 없다.
        // (catch 순서를 뒤바꾸는 건 자바가 컴파일 단계에서 막는다 — BusinessException은
        //  Exception의 하위 타입이라 "already been caught"가 된다. 실제 위험은 재던지기 누락이다.)
        String token = jwtTokenProvider.generateAccessToken("user-blacklisted", "USER");
        when(redisTemplate.hasKey(anyString())).thenReturn(true);

        assertThatThrownBy(() -> jwtTokenProvider.validateToken(token))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(ErrorCode.JWT_REVOKED));
    }

    @Test
    void redisFailureFailsOpenAndReturnsClaims() {
        // 회귀 방지 핵심(2/2): 위 테스트와 나란히 둔다. Redis 장애(hasKey가 예외를 던짐) 시에는
        // catch (Exception e)로 흡수되어 예외 없이 Claims가 반환돼야 한다(fail-open).
        // 두 테스트를 함께 보면 계약이 드러난다 — **JWT_REVOKED는 던지고, 그 외 예외는 삼킨다.**
        // 하나만 있으면 반쪽짜리다: 이 테스트만 있으면 재던지기를 지워도 통과하고,
        // 위 테스트만 있으면 try-catch를 통째로 지워도 통과한다.
        String token = jwtTokenProvider.generateAccessToken("user-redis-down", "USER");
        when(redisTemplate.hasKey(anyString())).thenThrow(new QueryTimeoutException("redis timeout"));

        Claims claims = jwtTokenProvider.validateToken(token);

        assertThat(claims.getSubject()).isEqualTo("user-redis-down");
    }
}

package com.cloumy.auth.security;

import com.cloumy.common.config.AppProperties;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.UnsupportedJwtException;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class JwtTokenProvider {

    private static final String BLACKLIST_KEY_PREFIX = "jwt_blacklist:";

    private final AppProperties appProperties;
    private final StringRedisTemplate redisTemplate;

    private SecretKey secretKey;

    @PostConstruct
    public void init() {
        secretKey = Keys.hmacShaKeyFor(Decoders.BASE64URL.decode(appProperties.getJwt().secret()));
    }

    public String generateAccessToken(String userId, String role) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .id(UUID.randomUUID().toString())
                .claim("role", role)
                .claim("type", "access")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(appProperties.getJwt().accessTtl())))
                .signWith(secretKey)
                .compact();
    }

    public String generateRefreshToken(String userId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .id(UUID.randomUUID().toString())
                .claim("type", "refresh")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(appProperties.getJwt().refreshTtl())))
                .signWith(secretKey)
                .compact();
    }

    public Claims validateToken(String token) {
        Claims claims;
        try {
            claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (ExpiredJwtException e) {
            throw new BusinessException(ErrorCode.JWT_EXPIRED);
        } catch (UnsupportedJwtException e) {
            throw new BusinessException(ErrorCode.JWT_UNSUPPORTED);
        } catch (JwtException | IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.JWT_INVALID);
        }

        // 로그아웃 처리된 토큰 차단 — Redis 장애 시 fail-open.
        // RateLimitFilter와 같은 정책이다: 부가 기능(블랙리스트) 때문에 인증 전체가
        // 막히면 안 된다. 로그아웃된 토큰이 만료 전까지 살아남는 위험보다 전면 장애가 크다.
        try {
            if (Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_KEY_PREFIX + claims.getId()))) {
                throw new BusinessException(ErrorCode.JWT_REVOKED);
            }
        } catch (BusinessException e) {
            throw e;                                  // JWT_REVOKED는 그대로 올려보낸다
        } catch (Exception e) {
            log.warn("JWT 블랙리스트 조회 실패 — 통과 처리: {}", e.getMessage());
        }

        return claims;
    }

    public void revokeToken(Claims claims) {
        Duration remaining = getRemainingTtl(claims);
        if (!remaining.isNegative()) {
            redisTemplate.opsForValue().set(
                    BLACKLIST_KEY_PREFIX + claims.getId(),
                    "revoked",
                    remaining
            );
        }
    }

    public String extractUserId(Claims claims) {
        return claims.getSubject();
    }

    public String extractRole(Claims claims) {
        return claims.get("role", String.class);
    }

    public String extractJti(Claims claims) {
        return claims.getId();
    }

    public Duration getRemainingTtl(Claims claims) {
        return Duration.between(Instant.now(), claims.getExpiration().toInstant());
    }
}

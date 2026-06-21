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
        secretKey = Keys.hmacShaKeyFor(Decoders.BASE64.decode(appProperties.getJwt().secret()));
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

        // 로그아웃 처리된 토큰 차단
        if (Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_KEY_PREFIX + claims.getId()))) {
            throw new BusinessException(ErrorCode.JWT_REVOKED);
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

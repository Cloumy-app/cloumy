package com.cloumy.common.filter;

import com.cloumy.common.response.ApiResponse;
import com.cloumy.common.response.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.UUID;

// 루트 생성(LLM 호출) 남용 방지 — 사용자당 1분 3회. Spring Cloud Gateway 없이 단일 앱 구조라
// Filter + Redis로 구현(Gateway 도입 시 이전 검토). @Component로 등록하지 않고 SecurityConfig에서
// 직접 new해서 addFilterAfter로만 붙인다 — @Component였다면 Spring Boot가 서블릿 필터로도 자동
// 등록해서 요청마다 두 번 실행되고, 그러면 카운터가 매번 2씩 늘어 실제 허용량이 반토막난다.
@Slf4j
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private static final int LIMIT = 3;
    private static final Duration WINDOW = Duration.ofSeconds(60);
    private static final RequestMatcher ROUTE_GENERATE_MATCHER =
            new AntPathRequestMatcher("/v1/routes/generate", "POST");

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        if (!ROUTE_GENERATE_MATCHER.matches(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            // 토큰이 없는 요청 — JwtAuthenticationFilter가 그냥 통과시키므로 여기 도달 가능.
            // 뒤에서 AuthorizationFilter가 401(TOKEN_INVALID)로 처리하도록 위임한다.
            filterChain.doFilter(request, response);
            return;
        }

        String key = "ratelimit:routes:generate:" + auth.getName();
        long now = System.currentTimeMillis();
        try {
            redisTemplate.opsForZSet().removeRangeByScore(key, 0, now - WINDOW.toMillis());
            Long count = redisTemplate.opsForZSet().zCard(key);
            if (count != null && count >= LIMIT) {
                sendErrorResponse(response, ErrorCode.RATE_LIMIT_EXCEEDED);
                return;
            }
            redisTemplate.opsForZSet().add(key, UUID.randomUUID().toString(), now);
            redisTemplate.expire(key, WINDOW);
        } catch (Exception e) {
            // Redis 장애 시 fail-open — AiServiceClient의 캐시 조회 실패 폴백과 동일한 정책.
            // 비용 절감보다 핵심 기능(루트 생성)을 막지 않는 게 우선이다.
            log.warn("레이트리밋 확인 실패 — 통과 처리: {}", e.getMessage());
        }

        filterChain.doFilter(request, response);
    }

    private void sendErrorResponse(HttpServletResponse response, ErrorCode errorCode) throws IOException {
        response.setStatus(errorCode.getHttpStatus().value());
        response.setHeader("Retry-After", String.valueOf(WINDOW.toSeconds()));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE + ";charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(errorCode)));
    }
}

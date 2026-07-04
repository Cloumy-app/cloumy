package com.cloumy.auth.config;

import com.cloumy.auth.security.JwtAuthenticationFilter;
import com.cloumy.common.filter.RateLimitFilter;
import com.cloumy.common.response.ApiResponse;
import com.cloumy.common.response.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.io.IOException;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        // @Component로 등록하지 않고 여기서 직접 생성 — Spring Boot의 서블릿 필터 자동 등록 대상이
        // 되지 않도록 해서 요청당 정확히 한 번만 실행되게 한다(RateLimitFilter 클래스 주석 참고)
        RateLimitFilter rateLimitFilter = new RateLimitFilter(redisTemplate, objectMapper);

        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // SSE/Async 완료 시 Tomcat이 재디스패치하는 ASYNC 요청은 인증 재검사 제외
                        .dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()
                        .requestMatchers(
                                "/v1/auth/**",
                                "/v1/dev/**",   // @Profile("dev") 전용 — prod에서는 컨트롤러 빈 자체가 없어 404
                                "/actuator/health",
                                "/error"
                        ).permitAll()
                        .anyRequest().authenticated()
                )
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(rateLimitFilter, JwtAuthenticationFilter.class)
                .exceptionHandling(ex -> ex
                        // 인증 정보 없음 (토큰 누락 등) → 401
                        .authenticationEntryPoint((request, response, e) ->
                                sendErrorResponse(response, ErrorCode.JWT_INVALID)
                        )
                        // 인증은 됐으나 권한 부족 → 403
                        .accessDeniedHandler((request, response, e) ->
                                sendErrorResponse(response, ErrorCode.FORBIDDEN)
                        )
                )
                .build();
    }

    // 소셜 로그인 전용이라 실제 사용은 없으나 Spring Security 내부에서 빈으로 요구함
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    private void sendErrorResponse(
            jakarta.servlet.http.HttpServletResponse response,
            ErrorCode errorCode
    ) throws IOException {
        response.setStatus(errorCode.getHttpStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE + ";charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(errorCode)));
    }
}

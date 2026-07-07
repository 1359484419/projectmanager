package pm.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import pm.auth.JwtAuthFilter;
import pm.mcp.PatAuthFilter;

/**
 * 无状态 JWT 安全配置：/api/health 与 /api/auth/** 放行，其余要求认证。
 * 未认证统一返回 401 {code, message}。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter,
                                            PatAuthFilter patAuthFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/health", "/api/auth/**").permitAll()
                        .requestMatchers("/api/**", "/mcp/**").authenticated()
                        // 其余为前端静态资源与 SPA 路由（fallback 到 index.html），无需认证
                        .anyRequest().permitAll())
                .exceptionHandling(eh -> eh.authenticationEntryPoint((request, response, ex) -> {
                    response.setStatus(401);
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write("{\"code\":\"UNAUTHENTICATED\",\"message\":\"authentication required\"}");
                }))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                // PAT（pmt_ 前缀）在 JWT 之前识别，仅作用于 /mcp/** 与 /api/t/**
                .addFilterBefore(patAuthFilter, JwtAuthFilter.class);
        return http.build();
    }
}

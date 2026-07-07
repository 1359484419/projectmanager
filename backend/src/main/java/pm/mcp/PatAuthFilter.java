package pm.mcp;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import pm.tenant.TenantContext;
import pm.tenantadmin.MembershipRepository;

import java.io.IOException;
import java.time.Instant;
import java.util.List;

/**
 * PAT 认证：识别 Authorization: Bearer pmt_... 前缀 → 查 hash →
 * 注入用户身份（SecurityContext principal=userId）+ 直接设置 TenantContext（PAT 天然绑租户）
 * → 更新 last_used_at。仅对 /mcp/** 与 /api/t/** 生效；挂在 JWT filter 之前。
 * 请求结束在 finally 清理自己设置的 TenantContext（/api/t/** 上 TenantInterceptor 也会清，双保险）。
 */
@Component
public class PatAuthFilter extends OncePerRequestFilter {

    private static final String BEARER_PAT = "Bearer " + ApiToken.PREFIX;

    private final ApiTokenRepository tokens;
    private final MembershipRepository memberships;

    public PatAuthFilter(ApiTokenRepository tokens, MembershipRepository memberships) {
        this.tokens = tokens;
        this.memberships = memberships;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        boolean contextSetHere = false;
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PAT) && appliesTo(request)
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            String raw = header.substring(7);
            var tokenOpt = tokens.findByTokenHash(ApiToken.sha256(raw));
            if (tokenOpt.isPresent()) {
                ApiToken token = tokenOpt.get();
                // membership 可能在发 token 后被移除：无 membership 视为无效令牌
                var membership = memberships.findByUserIdAndTenantId(token.getUserId(), token.getTenantId());
                if (membership.isPresent()) {
                    var auth = new UsernamePasswordAuthenticationToken(token.getUserId(), null, List.of());
                    SecurityContextHolder.getContext().setAuthentication(auth);
                    TenantContext.set(token.getTenantId(), membership.get().getRole());
                    contextSetHere = true;
                    token.setLastUsedAt(Instant.now());
                    tokens.save(token);
                }
            }
        }
        try {
            chain.doFilter(request, response);
        } finally {
            if (contextSetHere) {
                TenantContext.clear();
            }
        }
    }

    private boolean appliesTo(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/api/t/") || path.equals("/mcp") || path.startsWith("/mcp/");
    }
}

package pm.auth;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import pm.common.ApiException;

/**
 * 从 SecurityContext 取当前用户 id（JwtAuthFilter/PatAuthFilter 注入的 principal）。
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static long id() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Long userId) {
            return userId;
        }
        throw ApiException.unauthorized("UNAUTHENTICATED", "not authenticated");
    }
}

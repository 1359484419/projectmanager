package pm.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import pm.tenant.TenantContext;
import pm.tenantadmin.Membership;

/**
 * 权限矩阵 harness 的执行层：读控制器方法上的 {@link RequireRole}，
 * 与 TenantInterceptor 已写入的 {@link TenantContext} 角色比对，不足则 403。
 * 必须注册在 TenantInterceptor 之后（WebConfig 控制 order），否则拿不到角色。
 * 角色只有 ADMIN/MEMBER 两级：要求 ADMIN 即必须是 ADMIN；要求 MEMBER 等于不限制。
 */
@Component
public class RequireRoleInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        RequireRole required = method.getMethodAnnotation(RequireRole.class);
        if (required == null) {
            return true;
        }
        Membership.Role actual = TenantContext.requireRole();
        if (required.value() == Membership.Role.ADMIN && actual != Membership.Role.ADMIN) {
            throw ApiException.forbiddenAdminOnly();
        }
        return true;
    }
}

package pm.tenant;

import pm.common.ApiException;
import pm.tenantadmin.Membership;

/**
 * 请求级租户上下文（ThreadLocal）。由 TenantInterceptor（或 PAT filter）设置，请求结束必须清理。
 * 业务代码只读：TenantContext.require()。
 */
public final class TenantContext {

    public record Ctx(long tenantId, Membership.Role role) {
    }

    private static final ThreadLocal<Ctx> HOLDER = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(long tenantId, Membership.Role role) {
        HOLDER.set(new Ctx(tenantId, role));
    }

    /** 当前租户 id；未设置视为资源不存在（404），杜绝无租户上下文的数据访问。 */
    public static long require() {
        Ctx ctx = HOLDER.get();
        if (ctx == null) {
            throw ApiException.notFound();
        }
        return ctx.tenantId();
    }

    /** 当前用户在本租户的角色。 */
    public static Membership.Role requireRole() {
        Ctx ctx = HOLDER.get();
        if (ctx == null) {
            throw ApiException.notFound();
        }
        return ctx.role();
    }

    public static boolean isSet() {
        return HOLDER.get() != null;
    }

    public static void clear() {
        HOLDER.remove();
    }
}

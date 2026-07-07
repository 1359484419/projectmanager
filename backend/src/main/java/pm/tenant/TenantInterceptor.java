package pm.tenant;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hibernate.Session;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.tenantadmin.Membership;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.Tenant;
import pm.tenantadmin.TenantRepository;

import java.util.Map;

/**
 * 多租户 harness 核心：匹配 /api/t/{slug}/**。
 * 1) slug → tenant（不存在 404）
 * 2) 当前用户 membership 校验（无 → 404，不泄露租户存在性）
 * 3) TenantContext.set(...)
 * 4) 借 OSIV 在请求级 Hibernate Session 上开启 tenantFilter，
 *    所有带 @Filter 的实体查询自动追加 tenant_id 过滤。
 * afterCompletion 清理 ThreadLocal。
 */
@Component
public class TenantInterceptor implements HandlerInterceptor {

    private final TenantRepository tenants;
    private final MembershipRepository memberships;
    private final EntityManager entityManager;

    public TenantInterceptor(TenantRepository tenants, MembershipRepository memberships,
                             EntityManager entityManager) {
        this.tenants = tenants;
        this.memberships = memberships;
        this.entityManager = entityManager;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // PAT filter 可能已设置租户上下文（PAT 天然绑租户），此时只需校验路径租户一致
        @SuppressWarnings("unchecked")
        Map<String, String> pathVars =
                (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        String slug = pathVars == null ? null : pathVars.get("slug");
        if (slug == null) {
            throw ApiException.notFound();
        }
        Tenant tenant = tenants.findBySlug(slug).orElseThrow(ApiException::notFound);
        if (TenantContext.isSet()) {
            if (TenantContext.require() != tenant.getId()) {
                throw ApiException.notFound();
            }
        } else {
            long userId = CurrentUser.id();
            Membership membership = memberships.findByUserIdAndTenantId(userId, tenant.getId())
                    .orElseThrow(ApiException::notFound);
            TenantContext.set(tenant.getId(), membership.getRole());
        }
        enableTenantFilter(tenant.getId());
        return true;
    }

    private void enableTenantFilter(long tenantId) {
        Session session = entityManager.unwrap(Session.class);
        // @FilterDef 定义在 TenantEntity 基类上，只有存在至少一个实体子类时 Hibernate 才注册它；
        // 尚无租户实体时跳过（此时也没有可被过滤的表）。
        if (session.getSessionFactory().getDefinedFilterNames().contains(TenantEntity.TENANT_FILTER)) {
            session.enableFilter(TenantEntity.TENANT_FILTER).setParameter("tenantId", tenantId);
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        TenantContext.clear();
    }
}

package pm.tenantadmin;

import java.time.Instant;

/**
 * 邀请：accept-invite 走 /api/auth/**（无租户上下文），故不继承 TenantEntity，
 * tenant_id 显式赋值、按 token 全局查找。
 * 纯 POJO，由 MyBatis 映射（mapper/InviteMapper.xml）。
 */
public class Invite {

    private Long id;

    private Long tenantId;

    private String token;

    private Membership.Role role;

    private Instant expiresAt;

    private Long createdBy;

    /** 一次性消费：accept 成功即写入；非空的 token 不可再用（410 INVITE_USED）。 */
    private Instant usedAt;

    private Long usedBy;

    protected Invite() {
    }

    public Invite(Long tenantId, String token, Membership.Role role, Instant expiresAt, Long createdBy) {
        this.tenantId = tenantId;
        this.token = token;
        this.role = role;
        this.expiresAt = expiresAt;
        this.createdBy = createdBy;
    }

    public Long getId() {
        return id;
    }

    public Long getTenantId() {
        return tenantId;
    }

    public String getToken() {
        return token;
    }

    public Membership.Role getRole() {
        return role;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUsedAt() {
        return usedAt;
    }

    public Long getUsedBy() {
        return usedBy;
    }

    public void markUsed(Long userId) {
        this.usedAt = Instant.now();
        this.usedBy = userId;
    }
}

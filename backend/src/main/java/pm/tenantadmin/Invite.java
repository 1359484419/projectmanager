package pm.tenantadmin;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 邀请：accept-invite 走 /api/auth/**（无租户上下文），故不继承 TenantEntity，
 * tenant_id 显式赋值、按 token 全局查找。
 */
@Entity
@Table(name = "invites")
public class Invite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(nullable = false, unique = true)
    private String token;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Membership.Role role;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

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
}

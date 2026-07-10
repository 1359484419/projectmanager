package pm.tenantadmin;

/** 成员关系。纯 POJO，由 MyBatis 映射（mapper/MembershipMapper.xml）。 */
public class Membership {

    public enum Role { ADMIN, MEMBER }

    private Long id;

    private Long userId;

    private Long tenantId;

    private Role role;

    protected Membership() {
    }

    public Membership(Long userId, Long tenantId, Role role) {
        this.userId = userId;
        this.tenantId = tenantId;
        this.role = role;
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public Long getTenantId() {
        return tenantId;
    }

    public Role getRole() {
        return role;
    }
}

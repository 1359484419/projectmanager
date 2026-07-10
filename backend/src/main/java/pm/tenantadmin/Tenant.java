package pm.tenantadmin;

import java.time.Instant;

/** 租户。纯 POJO，由 MyBatis 映射（mapper/TenantMapper.xml）。tenants 全局表。 */
public class Tenant {

    private Long id;

    private String slug;

    private String name;

    private Instant createdAt;

    protected Tenant() {
    }

    public Tenant(String slug, String name) {
        this.slug = slug;
        this.name = name;
    }

    public Long getId() {
        return id;
    }

    public String getSlug() {
        return slug;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}

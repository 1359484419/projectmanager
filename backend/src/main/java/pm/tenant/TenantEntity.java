package pm.tenant;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PrePersist;
import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;

/**
 * 所有租户内实体的基类：自动填 tenant_id。
 * 注意：Hibernate 的 @Filter 不会从 @MappedSuperclass 继承，
 * 每个子类实体必须自行标注：
 *   @Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
 */
@MappedSuperclass
@FilterDef(name = TenantEntity.TENANT_FILTER,
        parameters = @ParamDef(name = "tenantId", type = Long.class))
public abstract class TenantEntity {

    public static final String TENANT_FILTER = "tenantFilter";

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    public Long getTenantId() {
        return tenantId;
    }

    @PrePersist
    void fillTenantId() {
        if (tenantId == null) {
            tenantId = TenantContext.require();
        }
    }
}

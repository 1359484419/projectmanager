package pm.tenant;

/**
 * 所有租户内实体的基类：持有 tenant_id。
 * MyBatis 结果映射按字段反射填充（无 setter 也可）；
 * INSERT 时由各 Mapper 显式写入（实体已有值优先，否则 TenantContext.require()），
 * 与原 JPA @PrePersist 语义一致。
 */
public abstract class TenantEntity {

    private Long tenantId;

    public Long getTenantId() {
        return tenantId;
    }
}

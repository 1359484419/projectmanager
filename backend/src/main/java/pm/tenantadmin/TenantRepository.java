package pm.tenantadmin;

import org.apache.ibatis.annotations.Mapper;

import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/TenantMapper.xml。
 * tenants 是全局表，无租户条件。
 */
@Mapper
public interface TenantRepository {

    Optional<Tenant> findById(Long id);

    Optional<Tenant> findBySlug(String slug);

    boolean existsBySlug(String slug);

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Tenant save(Tenant tenant) {
        if (tenant.getId() == null) {
            insert(tenant);
        } else {
            update(tenant);
        }
        return tenant;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insert(Tenant tenant);

    int update(Tenant tenant);
}

package pm.sprint;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/CapacityOverrideMapper.xml。
 * capacity_overrides 是租户表：所有 SQL 显式带 tenant_id，
 * tenantId 由 default 方法从 TenantContext.require() 注入。
 */
@Mapper
public interface CapacityOverrideRepository {

    default List<CapacityOverride> findBySprintId(Long sprintId) {
        return selectBySprintId(sprintId, TenantContext.require());
    }

    default Optional<CapacityOverride> findBySprintIdAndUserId(Long sprintId, Long userId) {
        return selectBySprintIdAndUserId(sprintId, userId, TenantContext.require());
    }

    /**
     * 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。
     * tenant_id 与原 TenantEntity @PrePersist 语义一致：已有值优先，否则取 TenantContext.require()。
     */
    default CapacityOverride save(CapacityOverride override) {
        Long tenantId = override.getTenantId() != null ? override.getTenantId() : TenantContext.require();
        if (override.getId() == null) {
            insert(override, tenantId);
        } else {
            update(override, tenantId);
        }
        return override;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<CapacityOverride> selectBySprintId(@Param("sprintId") Long sprintId, @Param("tenantId") long tenantId);

    Optional<CapacityOverride> selectBySprintIdAndUserId(@Param("sprintId") Long sprintId,
                                                         @Param("userId") Long userId,
                                                         @Param("tenantId") long tenantId);

    void insert(@Param("o") CapacityOverride override, @Param("tenantId") Long tenantId);

    int update(@Param("o") CapacityOverride override, @Param("tenantId") Long tenantId);
}

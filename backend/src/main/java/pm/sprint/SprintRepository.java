package pm.sprint;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/SprintMapper.xml。
 * 对 Service 层暴露的方法签名与原 JpaRepository 完全一致。
 * sprints 是租户表：所有 SQL 显式带 tenant_id（原来靠 Hibernate tenantFilter），
 * tenantId 由 default 方法从 TenantContext.require() 注入。
 */
@Mapper
public interface SprintRepository {

    /** 按 PK 也带 tenant_id（与原 findOneById + tenantFilter 语义一致）。 */
    default Optional<Sprint> findOneById(Long id) {
        return selectById(id, TenantContext.require());
    }

    /** 与 findOneById 同义（原 JpaRepository.findById；本项目按 PK 查询统一带 tenant_id）。 */
    default Optional<Sprint> findById(Long id) {
        return selectById(id, TenantContext.require());
    }

    default Optional<Sprint> findByProjectIdAndStatus(Long projectId, Sprint.Status status) {
        return selectByProjectIdAndStatus(projectId, status, TenantContext.require());
    }

    /** 下个 Sprint = 起始日最早的 PLANNED。 */
    default Optional<Sprint> findFirstByProjectIdAndStatusOrderByStartDateAsc(Long projectId, Sprint.Status status) {
        return selectFirstByProjectIdAndStatusOrderByStartDate(projectId, status, TenantContext.require());
    }

    /** 最近关闭的若干 Sprint（MCP list_sprints 用）。 */
    default List<Sprint> findTop5ByProjectIdAndStatusOrderByEndDateDesc(Long projectId, Sprint.Status status) {
        return selectTop5ByProjectIdAndStatusOrderByEndDateDesc(projectId, status, TenantContext.require());
    }

    default List<Sprint> findByProjectIdOrderByIdDesc(Long projectId) {
        return selectByProjectIdOrderByIdDesc(projectId, TenantContext.require());
    }

    default long countByProjectId(Long projectId) {
        return countByProjectIdAndTenant(projectId, TenantContext.require());
    }

    /**
     * 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。
     * tenant_id 与原 TenantEntity @PrePersist 语义一致：已有值优先，否则取 TenantContext.require()。
     */
    default Sprint save(Sprint sprint) {
        Long tenantId = sprint.getTenantId() != null ? sprint.getTenantId() : TenantContext.require();
        if (sprint.getId() == null) {
            insert(sprint, tenantId);
        } else {
            update(sprint, tenantId);
        }
        return sprint;
    }

    /** 项目级联删除用：删项目下全部 Sprint。 */
    default void deleteByProjectId(Long projectId) {
        deleteByProjectIdT(projectId, TenantContext.require());
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    Optional<Sprint> selectById(@Param("id") Long id, @Param("tenantId") long tenantId);

    void deleteByProjectIdT(@Param("projectId") Long projectId, @Param("tenantId") long tenantId);

    Optional<Sprint> selectByProjectIdAndStatus(@Param("projectId") Long projectId,
                                                @Param("status") Sprint.Status status,
                                                @Param("tenantId") long tenantId);

    Optional<Sprint> selectFirstByProjectIdAndStatusOrderByStartDate(@Param("projectId") Long projectId,
                                                                     @Param("status") Sprint.Status status,
                                                                     @Param("tenantId") long tenantId);

    List<Sprint> selectTop5ByProjectIdAndStatusOrderByEndDateDesc(@Param("projectId") Long projectId,
                                                                  @Param("status") Sprint.Status status,
                                                                  @Param("tenantId") long tenantId);

    List<Sprint> selectByProjectIdOrderByIdDesc(@Param("projectId") Long projectId,
                                                @Param("tenantId") long tenantId);

    long countByProjectIdAndTenant(@Param("projectId") Long projectId, @Param("tenantId") long tenantId);

    void insert(@Param("s") Sprint sprint, @Param("tenantId") Long tenantId);

    int update(@Param("s") Sprint sprint, @Param("tenantId") Long tenantId);
}

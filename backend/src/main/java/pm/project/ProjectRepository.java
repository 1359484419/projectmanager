package pm.project;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/ProjectMapper.xml。
 * 对 Service 层暴露的方法签名与原 JpaRepository 完全一致。
 * projects 是租户表：除 findByAutoRotateTrue（自动轮转 job 跨租户遍历）外，
 * 所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface ProjectRepository {

    default Optional<Project> findByKey(String key) {
        return findByKeyAndTenant(key, TenantContext.require());
    }

    default Optional<Project> findOneById(Long id) {
        return findByIdAndTenant(id, TenantContext.require());
    }

    /** 锁项目行以串行分配任务 seq（SELECT ... FOR UPDATE）。 */
    default Optional<Project> findByKeyForUpdate(String key) {
        return findByKeyForUpdateAndTenant(key, TenantContext.require());
    }

    default boolean existsByKey(String key) {
        return countByKeyAndTenant(key, TenantContext.require()) > 0;
    }

    default List<Project> findAllByOrderByIdAsc() {
        return findAllByTenantOrderByIdAsc(TenantContext.require());
    }

    /** 供自动轮转 job 跨租户遍历（调度线程无 TenantContext），故意不带租户条件。 */
    List<Project> findByAutoRotateTrue();

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Project save(Project project) {
        if (project.getId() == null) {
            Long tenantId = project.getTenantId() != null
                    ? project.getTenantId() : TenantContext.require();
            insert(project, tenantId);
        } else {
            update(project, TenantContext.require());
        }
        return project;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    Optional<Project> findByKeyAndTenant(@Param("key") String key, @Param("tenantId") Long tenantId);

    Optional<Project> findByIdAndTenant(@Param("id") Long id, @Param("tenantId") Long tenantId);

    Optional<Project> findByKeyForUpdateAndTenant(@Param("key") String key,
                                                  @Param("tenantId") Long tenantId);

    int countByKeyAndTenant(@Param("key") String key, @Param("tenantId") Long tenantId);

    List<Project> findAllByTenantOrderByIdAsc(@Param("tenantId") Long tenantId);

    void insert(@Param("e") Project e, @Param("tenantId") Long tenantId);

    int update(@Param("e") Project e, @Param("tenantId") Long tenantId);
}

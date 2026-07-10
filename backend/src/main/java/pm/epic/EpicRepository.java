package pm.epic;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/EpicMapper.xml。
 * 对 Service 层暴露的方法签名与原 JpaRepository 完全一致。
 * epics 是租户表：所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface EpicRepository {

    default Optional<Epic> findOneById(Long id) {
        return findByIdAndTenant(id, TenantContext.require());
    }

    default Optional<Epic> findByIdAndProjectId(Long id, Long projectId) {
        return findByIdAndProjectIdAndTenant(id, projectId, TenantContext.require());
    }

    default List<Epic> findByProjectIdOrderByIdAsc(Long projectId) {
        return findByProjectIdAndTenantOrderByIdAsc(projectId, TenantContext.require());
    }

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Epic save(Epic epic) {
        if (epic.getId() == null) {
            Long tenantId = epic.getTenantId() != null
                    ? epic.getTenantId() : TenantContext.require();
            insert(epic, tenantId);
        } else {
            update(epic, TenantContext.require());
        }
        return epic;
    }

    /** 项目级联删除用：删项目下全部 Epic。 */
    default void deleteByProjectId(Long projectId) {
        deleteByProjectIdT(projectId, TenantContext.require());
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    Optional<Epic> findByIdAndTenant(@Param("id") Long id, @Param("tenantId") Long tenantId);

    void deleteByProjectIdT(@Param("projectId") Long projectId, @Param("tenantId") Long tenantId);

    Optional<Epic> findByIdAndProjectIdAndTenant(@Param("id") Long id,
                                                 @Param("projectId") Long projectId,
                                                 @Param("tenantId") Long tenantId);

    List<Epic> findByProjectIdAndTenantOrderByIdAsc(@Param("projectId") Long projectId,
                                                    @Param("tenantId") Long tenantId);

    void insert(@Param("e") Epic e, @Param("tenantId") Long tenantId);

    int update(@Param("e") Epic e, @Param("tenantId") Long tenantId);
}

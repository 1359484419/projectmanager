package pm.task;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper。SQL 在 resources/mapper/SubtaskMapper.xml。
 * subtasks 是租户表：所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface SubtaskRepository {

    default List<Subtask> findByTaskIdOrderByIdAsc(Long taskId) {
        return findByTaskIdT(taskId, TenantContext.require());
    }

    default Optional<Subtask> findOneById(Long id) {
        return findOneByIdT(id, TenantContext.require());
    }

    default void deleteByTaskId(Long taskId) {
        deleteByTaskIdT(taskId, TenantContext.require());
    }

    default void delete(Subtask subtask) {
        deleteByIdT(subtask.getId(), TenantContext.require());
    }

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Subtask save(Subtask subtask) {
        Long tenantId = subtask.getTenantId() != null ? subtask.getTenantId() : TenantContext.require();
        if (subtask.getId() == null) {
            insert(subtask, tenantId);
        } else {
            update(subtask, tenantId);
        }
        return subtask;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<Subtask> findByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    Optional<Subtask> findOneByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);

    void deleteByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    void deleteByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);

    void insert(@Param("s") Subtask subtask, @Param("tenantId") long tenantId);

    int update(@Param("s") Subtask subtask, @Param("tenantId") long tenantId);
}

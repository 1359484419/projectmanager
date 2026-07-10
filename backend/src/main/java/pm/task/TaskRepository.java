package pm.task;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/TaskMapper.xml。
 * 对 Service 层暴露的方法签名与原 JpaRepository 完全一致。
 * tasks 是租户表：所有语句显式带 tenant_id = TenantContext.require()（原靠 Hibernate tenantFilter）。
 * 乐观锁：UPDATE 带 version 条件并自增，0 行命中 → 409 CONFLICT（原 @Version 语义）。
 */
@Mapper
public interface TaskRepository {

    default Optional<Task> findOneById(Long id) {
        return findOneByIdT(id, TenantContext.require());
    }

    /** 与原 JpaRepository.findById 等价；此处同样带租户条件（比 em.find 更严格）。 */
    default Optional<Task> findById(Long id) {
        return findOneById(id);
    }

    default Optional<Task> findByProjectIdAndSeq(Long projectId, int seq) {
        return findByProjectIdAndSeqT(projectId, seq, TenantContext.require());
    }

    default List<Task> findByProjectIdAndSprintIdIsNullOrderByRankAsc(Long projectId) {
        return findBacklogT(projectId, TenantContext.require());
    }

    default List<Task> findBySprintIdOrderByRankAsc(Long sprintId) {
        return findBySprintIdT(sprintId, TenantContext.require());
    }

    default List<Task> findByEpicIdInOrderByRankAsc(java.util.Collection<Long> epicIds) {
        List<Long> list = new ArrayList<>(epicIds);
        if (list.isEmpty()) {
            return List.of();
        }
        return findByEpicIdInT(list, TenantContext.require());
    }

    default List<Task> findByAssigneeIdAndStatusNot(Long assigneeId, Task.Status status) {
        return findByAssigneeIdAndStatusNotT(assigneeId, status, TenantContext.require());
    }

    /**
     * 关键词搜索（标题/描述，大小写不敏感）；% _ \ 转义后 ESCAPE，防用户输入当通配符。
     * 原签名的 Pageable 是 Spring Data 类型，随 data-jpa 移除改为显式 limit/offset。
     */
    default List<Task> search(String q, int limit, int offset) {
        String escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return searchT("%" + escaped + "%", limit, offset, TenantContext.require());
    }

    default int maxSeq(Long projectId) {
        return maxSeqT(projectId, TenantContext.require());
    }

    default Optional<String> maxRank(Long projectId) {
        return maxRankT(projectId, TenantContext.require());
    }

    /** 与 JpaRepository.findAllById 签名一致；空集合直接返回，避免 SQL IN ()。 */
    default List<Task> findAllById(Iterable<Long> ids) {
        List<Long> list = new ArrayList<>();
        ids.forEach(list::add);
        if (list.isEmpty()) {
            return List.of();
        }
        return findAllByIdListT(list, TenantContext.require());
    }

    /**
     * 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id，version 由 DB DEFAULT 0），
     * 否则带 version 条件的全字段 UPDATE；0 行命中 = 并发冲突 →
     * 抛 OptimisticLockingFailureException（与原 Hibernate @Version 异常类型一致，
     * 当前事务回滚，由 GlobalExceptionHandler 统一映射 409 CONFLICT，报文不变）。
     */
    default Task save(Task task) {
        if (task.getId() == null) {
            Long tenantId = task.getTenantId() != null ? task.getTenantId() : TenantContext.require();
            insert(task, tenantId);
        } else {
            int rows = update(task, TenantContext.require());
            if (rows == 0) {
                throw new org.springframework.dao.OptimisticLockingFailureException(
                        "task " + task.getId() + " was updated concurrently (stale version "
                                + task.getVersion() + ")");
            }
            task.setVersion(task.getVersion() + 1); // 与 DB 同步，事务内再次 save 不误判冲突
        }
        return task;
    }

    default void delete(Task task) {
        deleteByIdT(task.getId(), TenantContext.require());
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    Optional<Task> findOneByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);

    Optional<Task> findByProjectIdAndSeqT(@Param("projectId") Long projectId, @Param("seq") int seq,
                                          @Param("tenantId") long tenantId);

    List<Task> findBacklogT(@Param("projectId") Long projectId, @Param("tenantId") long tenantId);

    List<Task> findBySprintIdT(@Param("sprintId") Long sprintId, @Param("tenantId") long tenantId);

    List<Task> findByEpicIdInT(@Param("epicIds") List<Long> epicIds, @Param("tenantId") long tenantId);

    List<Task> findByAssigneeIdAndStatusNotT(@Param("assigneeId") Long assigneeId,
                                             @Param("status") Task.Status status,
                                             @Param("tenantId") long tenantId);

    List<Task> searchT(@Param("pattern") String pattern, @Param("limit") int limit,
                       @Param("offset") int offset, @Param("tenantId") long tenantId);

    int maxSeqT(@Param("projectId") Long projectId, @Param("tenantId") long tenantId);

    Optional<String> maxRankT(@Param("projectId") Long projectId, @Param("tenantId") long tenantId);

    List<Task> findAllByIdListT(@Param("ids") List<Long> ids, @Param("tenantId") long tenantId);

    void insert(@Param("t") Task task, @Param("tenantId") long tenantId);

    int update(@Param("t") Task task, @Param("tenantId") long tenantId);

    void deleteByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);
}

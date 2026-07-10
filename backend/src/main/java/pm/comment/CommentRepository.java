package pm.comment;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/CommentMapper.xml。
 * comments 是租户表：所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface CommentRepository {

    default List<Comment> findByTaskIdOrderByCreatedAtAscIdAsc(Long taskId) {
        return findByTaskIdT(taskId, TenantContext.require());
    }

    default void deleteByTaskId(Long taskId) {
        deleteByTaskIdT(taskId, TenantContext.require());
    }

    /** 项目级联删除用：按任务 id 批量删评论；空集合直接返回，避免 SQL IN ()。 */
    default void deleteByTaskIdIn(java.util.Collection<Long> taskIds) {
        List<Long> list = new java.util.ArrayList<>(taskIds);
        if (list.isEmpty()) {
            return;
        }
        deleteByTaskIdInT(list, TenantContext.require());
    }

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Comment save(Comment comment) {
        Long tenantId = comment.getTenantId() != null ? comment.getTenantId() : TenantContext.require();
        if (comment.getId() == null) {
            insert(comment, tenantId);
        } else {
            update(comment, tenantId);
        }
        return comment;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<Comment> findByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    void deleteByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    void deleteByTaskIdInT(@Param("taskIds") List<Long> taskIds, @Param("tenantId") long tenantId);

    void insert(@Param("c") Comment comment, @Param("tenantId") long tenantId);

    int update(@Param("c") Comment comment, @Param("tenantId") long tenantId);
}

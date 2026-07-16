package pm.notification;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;

/**
 * MyBatis Mapper。SQL 在 resources/mapper/NotificationMapper.xml。
 * notifications 是租户表：所有语句显式 tenant_id = TenantContext.require()。
 * 列表查询 JOIN tasks/projects 直接带出标题与 displayKey，避免 N+1。
 */
@Mapper
public interface NotificationRepository {

    default List<NotificationRow> findRecentByUser(Long userId, int limit) {
        return findRecentByUserT(userId, limit, TenantContext.require());
    }

    default long countUnread(Long userId) {
        return countUnreadT(userId, TenantContext.require());
    }

    /** 标单条已读：只允许标自己的；已读的重复标不报错（幂等）。返回受影响行数。 */
    default int markRead(Long id, Long userId) {
        return markReadT(id, userId, TenantContext.require());
    }

    default void markAllRead(Long userId) {
        markAllReadT(userId, TenantContext.require());
    }

    /** 任务删除级联用。 */
    default void deleteByTaskId(Long taskId) {
        deleteByTaskIdT(taskId, TenantContext.require());
    }

    /** 项目级联删除用：空集合直接返回，避免 SQL IN ()。 */
    default void deleteByTaskIdIn(java.util.Collection<Long> taskIds) {
        List<Long> list = new java.util.ArrayList<>(taskIds);
        if (list.isEmpty()) {
            return;
        }
        deleteByTaskIdInT(list, TenantContext.require());
    }

    default Notification save(Notification n) {
        Long tenantId = n.getTenantId() != null ? n.getTenantId() : TenantContext.require();
        insert(n, tenantId);
        return n;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<NotificationRow> findRecentByUserT(@Param("userId") Long userId, @Param("limit") int limit,
                                            @Param("tenantId") long tenantId);

    long countUnreadT(@Param("userId") Long userId, @Param("tenantId") long tenantId);

    int markReadT(@Param("id") Long id, @Param("userId") Long userId, @Param("tenantId") long tenantId);

    void markAllReadT(@Param("userId") Long userId, @Param("tenantId") long tenantId);

    void deleteByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    void deleteByTaskIdInT(@Param("taskIds") List<Long> taskIds, @Param("tenantId") long tenantId);

    void insert(@Param("n") Notification n, @Param("tenantId") long tenantId);
}

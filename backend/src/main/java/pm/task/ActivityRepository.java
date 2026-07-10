package pm.task;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/ActivityMapper.xml。
 * activities 是租户表：所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface ActivityRepository {

    default List<Activity> findByTaskIdOrderByAtDescIdDesc(Long taskId) {
        return findByTaskIdT(taskId, TenantContext.require());
    }

    default void deleteByTaskId(Long taskId) {
        deleteByTaskIdT(taskId, TenantContext.require());
    }

    /** 燃尽图回放：涉及某 Sprint 的全部进出记录（old 或 new 为该 sprint id）。 */
    default List<Activity> sprintChangesTouching(String sprintId) {
        return sprintChangesTouchingT(sprintId, TenantContext.require());
    }

    /** 某批任务的全部 SPRINT_CHANGED（按时间升序），用于回放任务的 sprint 归属轨迹。 */
    default List<Activity> sprintChangesOfTasks(Collection<Long> taskIds) {
        List<Long> list = new ArrayList<>(taskIds);
        if (list.isEmpty()) {
            return List.of();
        }
        return sprintChangesOfTasksT(list, TenantContext.require());
    }

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Activity save(Activity activity) {
        Long tenantId = activity.getTenantId() != null ? activity.getTenantId() : TenantContext.require();
        if (activity.getId() == null) {
            insert(activity, tenantId);
        } else {
            update(activity, tenantId);
        }
        return activity;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<Activity> findByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    void deleteByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    List<Activity> sprintChangesTouchingT(@Param("sid") String sprintId, @Param("tenantId") long tenantId);

    List<Activity> sprintChangesOfTasksT(@Param("taskIds") List<Long> taskIds,
                                         @Param("tenantId") long tenantId);

    void insert(@Param("a") Activity activity, @Param("tenantId") long tenantId);

    int update(@Param("a") Activity activity, @Param("tenantId") long tenantId);
}

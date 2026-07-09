package pm.task;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface ActivityRepository extends JpaRepository<Activity, Long> {

    List<Activity> findByTaskIdOrderByAtDescIdDesc(Long taskId);

    void deleteByTaskId(Long taskId);

    /** 燃尽图回放：涉及某 Sprint 的全部进出记录（old 或 new 为该 sprint id）。 */
    @Query("""
            select a from Activity a
            where a.type = 'SPRINT_CHANGED' and (a.oldValue = :sid or a.newValue = :sid)
            order by a.at asc, a.id asc""")
    List<Activity> sprintChangesTouching(@Param("sid") String sprintId);

    /** 某批任务的全部 SPRINT_CHANGED（按时间升序），用于回放任务的 sprint 归属轨迹。 */
    @Query("""
            select a from Activity a
            where a.type = 'SPRINT_CHANGED' and a.taskId in :taskIds
            order by a.at asc, a.id asc""")
    List<Activity> sprintChangesOfTasks(@Param("taskIds") Collection<Long> taskIds);
}

package pm.task;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 租户过滤靠 Hibernate tenantFilter；禁用 findById（em.find 绕过 @Filter），用 findOneById。
 */
public interface TaskRepository extends JpaRepository<Task, Long> {

    Optional<Task> findOneById(Long id);

    Optional<Task> findByProjectIdAndSeq(Long projectId, int seq);

    List<Task> findByProjectIdAndSprintIdIsNullOrderByRankAsc(Long projectId);

    List<Task> findBySprintIdOrderByRankAsc(Long sprintId);

    List<Task> findByEpicIdInOrderByRankAsc(java.util.Collection<Long> epicIds);

    @Query("select coalesce(max(t.seq), 0) from Task t where t.projectId = :projectId")
    int maxSeq(@Param("projectId") Long projectId);

    @Query("select max(t.rank) from Task t where t.projectId = :projectId")
    Optional<String> maxRank(@Param("projectId") Long projectId);
}

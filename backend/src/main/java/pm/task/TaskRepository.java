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

    List<Task> findByAssigneeIdAndStatusNot(Long assigneeId, Task.Status status);

    /** 关键词搜索（标题/描述，大小写不敏感）；租户隔离由 tenantFilter 保证。 */
    @Query("""
            select t from Task t
            where lower(t.title) like lower(concat('%', :q, '%'))
               or lower(t.description) like lower(concat('%', :q, '%'))
            order by t.id desc
            """)
    List<Task> search(@Param("q") String q, org.springframework.data.domain.Pageable pageable);

    @Query("select coalesce(max(t.seq), 0) from Task t where t.projectId = :projectId")
    int maxSeq(@Param("projectId") Long projectId);

    @Query("select max(t.rank) from Task t where t.projectId = :projectId")
    Optional<String> maxRank(@Param("projectId") Long projectId);
}

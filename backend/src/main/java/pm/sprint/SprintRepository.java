package pm.sprint;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 租户过滤靠 Hibernate tenantFilter；禁用 findById（em.find 绕过 @Filter），用 findOneById。
 */
public interface SprintRepository extends JpaRepository<Sprint, Long> {

    Optional<Sprint> findOneById(Long id);

    Optional<Sprint> findByProjectIdAndStatus(Long projectId, Sprint.Status status);

    /** 下个 Sprint = 起始日最早的 PLANNED。 */
    Optional<Sprint> findFirstByProjectIdAndStatusOrderByStartDateAsc(Long projectId, Sprint.Status status);

    /** 最近关闭的若干 Sprint（MCP list_sprints 用）。 */
    List<Sprint> findTop5ByProjectIdAndStatusOrderByEndDateDesc(Long projectId, Sprint.Status status);

    List<Sprint> findByProjectIdOrderByIdDesc(Long projectId);

    long countByProjectId(Long projectId);
}

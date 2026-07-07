package pm.project;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 注意：租户过滤依赖 Hibernate tenantFilter（HQL/派生查询生效）。
 * 不要用 findById（em.find 绕过 @Filter），一律走派生查询。
 */
public interface ProjectRepository extends JpaRepository<Project, Long> {

    Optional<Project> findByKey(String key);

    boolean existsByKey(String key);

    List<Project> findAllByOrderByIdAsc();
}

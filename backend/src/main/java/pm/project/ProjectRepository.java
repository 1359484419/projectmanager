package pm.project;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 注意：租户过滤依赖 Hibernate tenantFilter（HQL/派生查询生效）。
 * 不要用 findById（em.find 绕过 @Filter），一律走派生查询。
 */
public interface ProjectRepository extends JpaRepository<Project, Long> {

    Optional<Project> findByKey(String key);

    Optional<Project> findOneById(Long id);

    /** 锁项目行以串行分配任务 seq（SELECT ... FOR UPDATE）。 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.key = :key")
    Optional<Project> findByKeyForUpdate(@Param("key") String key);

    boolean existsByKey(String key);

    List<Project> findAllByOrderByIdAsc();

    /** 供自动轮转 job 跨租户遍历（调度线程未开 tenantFilter）。 */
    List<Project> findByAutoRotateTrue();
}

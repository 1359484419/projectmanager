package pm.epic;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/** 租户过滤靠 tenantFilter；用 findOneById 代替 findById（后者绕过 @Filter）。 */
public interface EpicRepository extends JpaRepository<Epic, Long> {

    Optional<Epic> findOneById(Long id);

    Optional<Epic> findByIdAndProjectId(Long id, Long projectId);

    List<Epic> findByProjectIdOrderByIdAsc(Long projectId);
}

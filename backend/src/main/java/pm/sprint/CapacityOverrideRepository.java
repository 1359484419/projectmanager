package pm.sprint;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CapacityOverrideRepository extends JpaRepository<CapacityOverride, Long> {

    List<CapacityOverride> findBySprintId(Long sprintId);

    Optional<CapacityOverride> findBySprintIdAndUserId(Long sprintId, Long userId);
}

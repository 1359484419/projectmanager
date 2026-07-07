package pm.tenantadmin;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MembershipRepository extends JpaRepository<Membership, Long> {

    List<Membership> findByUserId(Long userId);

    Optional<Membership> findByUserIdAndTenantId(Long userId, Long tenantId);
}

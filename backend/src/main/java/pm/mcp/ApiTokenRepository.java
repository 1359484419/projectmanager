package pm.mcp;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApiTokenRepository extends JpaRepository<ApiToken, Long> {

    Optional<ApiToken> findByTokenHash(String tokenHash);

    List<ApiToken> findByUserIdOrderByIdDesc(Long userId);

    Optional<ApiToken> findByIdAndUserId(Long id, Long userId);

    void deleteByUserIdAndTenantId(Long userId, Long tenantId);
}

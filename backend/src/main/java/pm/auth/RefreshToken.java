package pm.auth;

import java.time.Instant;

/** refresh_tokens 表实体（纯 POJO，MyBatis 映射，全局表无租户字段）。 */
public class RefreshToken {

    private Long id;

    private Long userId;

    private String tokenHash;

    private Instant expiresAt;

    protected RefreshToken() {
    }

    public RefreshToken(Long userId, String tokenHash, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}

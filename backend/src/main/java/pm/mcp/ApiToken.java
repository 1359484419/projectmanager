package pm.mcp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;

/**
 * 个人访问令牌（PAT）。绑定 用户+租户；库存 SHA-256 hash，明文只在创建时返回一次。
 * 注意：这是「个人资源」（/api/me 下管理，请求无 TenantContext），
 * 故不继承 TenantEntity，tenant_id 由创建时显式指定。
 * 纯 POJO，由 MyBatis 映射（mapper/ApiTokenMapper.xml）。
 */
public class ApiToken {

    public static final String PREFIX = "pmt_";

    private Long id;

    private Long tenantId;

    private Long userId;

    private String tokenHash;

    private String name;

    private Instant createdAt = Instant.now();

    private Instant lastUsedAt;

    protected ApiToken() {
    }

    public ApiToken(Long tenantId, Long userId, String tokenHash, String name) {
        this.tenantId = tenantId;
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.name = name;
    }

    public static String sha256(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public Long getId() {
        return id;
    }

    public Long getTenantId() {
        return tenantId;
    }

    public Long getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastUsedAt() {
        return lastUsedAt;
    }

    public void setLastUsedAt(Instant lastUsedAt) {
        this.lastUsedAt = lastUsedAt;
    }
}

package pm.mcp;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.Tenant;
import pm.tenantadmin.TenantRepository;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * PAT 管理（个人资源，/api/me 下，无租户上下文）。
 * 明文 token 只在创建响应里出现一次；库存 SHA-256。
 */
@RestController
@RequestMapping("/api/me/tokens")
public class PatController {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ApiTokenRepository tokens;
    private final TenantRepository tenants;
    private final MembershipRepository memberships;

    public PatController(ApiTokenRepository tokens, TenantRepository tenants,
                         MembershipRepository memberships) {
        this.tokens = tokens;
        this.tenants = tenants;
        this.memberships = memberships;
    }

    public record CreateRequest(String name, String tenantSlug) {
    }

    public record CreatedView(Long id, String name, String tenantSlug, String token, Instant createdAt) {
    }

    public record TokenView(Long id, String name, String tenantSlug, Instant createdAt, Instant lastUsedAt) {
    }

    @PostMapping
    CreatedView create(@RequestBody CreateRequest req) {
        long userId = CurrentUser.id();
        if (req.name() == null || req.name().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "name is required");
        }
        if (req.tenantSlug() == null || req.tenantSlug().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "tenantSlug is required");
        }
        Tenant tenant = tenants.findBySlug(req.tenantSlug()).orElseThrow(ApiException::notFound);
        // 非成员 → 404，不泄露租户存在性
        memberships.findByUserIdAndTenantId(userId, tenant.getId()).orElseThrow(ApiException::notFound);
        String raw = ApiToken.PREFIX + randomToken();
        ApiToken token = tokens.save(new ApiToken(tenant.getId(), userId, ApiToken.sha256(raw), req.name()));
        return new CreatedView(token.getId(), token.getName(), tenant.getSlug(), raw, token.getCreatedAt());
    }

    @GetMapping
    List<TokenView> list() {
        long userId = CurrentUser.id();
        return tokens.findByUserIdOrderByIdDesc(userId).stream()
                .map(t -> new TokenView(t.getId(), t.getName(),
                        tenants.findById(t.getTenantId()).map(Tenant::getSlug).orElse(null),
                        t.getCreatedAt(), t.getLastUsedAt()))
                .toList();
    }

    @DeleteMapping("/{id}")
    Map<String, Object> revoke(@PathVariable Long id) {
        long userId = CurrentUser.id();
        ApiToken token = tokens.findByIdAndUserId(id, userId).orElseThrow(ApiException::notFound);
        tokens.delete(token);
        return Map.of("revoked", true);
    }

    /** 48 位 URL-safe 随机串（36 字节 → base64url 48 字符）。 */
    private static String randomToken() {
        byte[] bytes = new byte[36];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}

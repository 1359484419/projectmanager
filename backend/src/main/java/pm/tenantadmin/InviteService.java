package pm.tenantadmin;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.auth.AuthService;
import pm.common.ApiException;
import pm.tenant.TenantContext;
import pm.user.User;
import pm.user.UserRepository;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

@Service
public class InviteService {

    static final Duration INVITE_TTL = Duration.ofDays(7);

    private final InviteRepository invites;
    private final UserRepository users;
    private final MembershipRepository memberships;
    private final AuthService authService;
    private final String baseUrl;
    private final SecureRandom random = new SecureRandom();

    public record InviteView(String token, String url, Instant expiresAt) {
    }

    public InviteService(InviteRepository invites, UserRepository users,
                         MembershipRepository memberships, AuthService authService,
                         @Value("${pm.base-url:http://localhost:5173}") String baseUrl) {
        this.invites = invites;
        this.users = users;
        this.memberships = memberships;
        this.authService = authService;
        this.baseUrl = baseUrl;
    }

    /** 仅 ADMIN；MEMBER 视为管理资源不存在 → 404。 */
    @Transactional
    public InviteView create(Membership.Role role, long createdBy) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw ApiException.notFound();
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(INVITE_TTL);
        invites.save(new Invite(TenantContext.require(), token, role, expiresAt, createdBy));
        return new InviteView(token, baseUrl + "/accept-invite?token=" + token, expiresAt);
    }

    /**
     * 接受邀请：老用户（email 已存在且密码对）直接加 membership；新用户注册+加入。
     * 无效 token → 404；过期 → 410 INVITE_EXPIRED；已用 → 410 INVITE_USED；老用户密码错 → 401。
     * token 一次性消费（成功即作废）：防被踢成员拿旧链接自助重新加入；
     * 失败路径（密码错等）随事务回滚不消费，同一 token 可再试。
     */
    @Transactional
    public AuthService.TokenPair accept(String token, String email, String password, String displayName) {
        Invite invite = invites.findByToken(token).orElseThrow(ApiException::notFound);
        if (invite.getExpiresAt().isBefore(Instant.now())) {
            throw ApiException.gone("INVITE_EXPIRED", "invite link expired");
        }
        if (invite.getUsedAt() != null) {
            throw ApiException.gone("INVITE_USED", "invite link already used");
        }
        User user = users.findByEmail(email)
                .map(existing -> {
                    if (!authService.passwordMatches(password, existing.getPasswordHash())) {
                        throw ApiException.unauthorized("BAD_CREDENTIALS", "invalid email or password");
                    }
                    return existing;
                })
                .orElseGet(() -> users.save(new User(email, authService.hashPassword(password), displayName)));
        if (memberships.findByUserIdAndTenantId(user.getId(), invite.getTenantId()).isEmpty()) {
            memberships.save(new Membership(user.getId(), invite.getTenantId(), invite.getRole()));
        }
        invite.markUsed(user.getId());
        return authService.issueTokens(user.getId());
    }
}

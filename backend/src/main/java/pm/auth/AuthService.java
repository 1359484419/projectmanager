package pm.auth;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.ApiException;
import pm.tenantadmin.Membership;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.Tenant;
import pm.tenantadmin.TenantRepository;
import pm.user.User;
import pm.user.UserRepository;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

@Service
public class AuthService {

    static final Duration REFRESH_TTL = Duration.ofDays(30);
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9-]{3,32}$");

    private final UserRepository users;
    private final TenantRepository tenants;
    private final MembershipRepository memberships;
    private final RefreshTokenRepository refreshTokens;
    private final JwtService jwt;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();

    public record TokenPair(String accessToken, String refreshToken) {
    }

    public AuthService(UserRepository users, TenantRepository tenants,
                       MembershipRepository memberships, RefreshTokenRepository refreshTokens,
                       JwtService jwt) {
        this.users = users;
        this.tenants = tenants;
        this.memberships = memberships;
        this.refreshTokens = refreshTokens;
        this.jwt = jwt;
    }

    @Transactional
    public TokenPair register(String email, String password, String displayName,
                              String tenantName, String tenantSlug) {
        if (!SLUG.matcher(tenantSlug).matches()) {
            throw ApiException.badRequest("INVALID_SLUG", "slug must match ^[a-z0-9-]{3,32}$");
        }
        if (tenants.existsBySlug(tenantSlug)) {
            throw ApiException.conflict("SLUG_TAKEN", "tenant slug already taken");
        }
        if (users.findByEmail(email).isPresent()) {
            throw ApiException.conflict("EMAIL_TAKEN", "email already registered");
        }
        User user = users.save(new User(email, passwordEncoder.encode(password), displayName));
        Tenant tenant = tenants.save(new Tenant(tenantSlug, tenantName));
        memberships.save(new Membership(user.getId(), tenant.getId(), Membership.Role.ADMIN));
        return issueTokens(user.getId());
    }

    @Transactional
    public TokenPair login(String email, String password) {
        User user = users.findByEmail(email)
                .filter(u -> passwordEncoder.matches(password, u.getPasswordHash()))
                .orElseThrow(() -> ApiException.unauthorized("BAD_CREDENTIALS", "invalid email or password"));
        return issueTokens(user.getId());
    }

    @Transactional
    public TokenPair refresh(String refreshToken) {
        RefreshToken stored = refreshTokens.findByTokenHash(sha256(refreshToken))
                .orElseThrow(() -> ApiException.unauthorized("INVALID_REFRESH", "refresh token invalid"));
        if (stored.getExpiresAt().isBefore(Instant.now())) {
            refreshTokens.delete(stored);
            throw ApiException.unauthorized("INVALID_REFRESH", "refresh token expired");
        }
        // 轮换：旧 token 作废，发新对
        refreshTokens.delete(stored);
        return issueTokens(stored.getUserId());
    }

    @Transactional
    public TokenPair issueTokens(long userId) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        refreshTokens.save(new RefreshToken(userId, sha256(refresh), Instant.now().plus(REFRESH_TTL)));
        return new TokenPair(jwt.generateAccess(userId), refresh);
    }

    public boolean passwordMatches(String rawPassword, String hash) {
        return passwordEncoder.matches(rawPassword, hash);
    }

    public String hashPassword(String rawPassword) {
        return passwordEncoder.encode(rawPassword);
    }

    static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes()));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}

package pm.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.Optional;

/**
 * Access token：HS256 JWT，30 分钟。secret 由 JWT_SECRET env 覆盖（生产必须设置）。
 * 启动守卫：非 dev profile 下 secret 仍为开发默认值 → 拒绝启动（fail-fast）。
 */
@Service
public class JwtService {

    static final Duration ACCESS_TTL = Duration.ofMinutes(30);

    /** application.yml 中的开发默认 secret，生产禁用。 */
    static final String DEV_DEFAULT_SECRET = "dev-only-secret-change-me-0123456789abcdef";

    private final SecretKey key;

    public JwtService(@Value("${pm.jwt.secret}") String secret, Environment env) {
        if (DEV_DEFAULT_SECRET.equals(secret)
                && !Arrays.asList(env.getActiveProfiles()).contains("dev")) {
            throw new IllegalStateException(
                    "JWT secret 仍为开发默认值：请设置 JWT_SECRET 环境变量（HS256 至少 32 字节），"
                            + "或本地开发以 dev profile 启动（--spring.profiles.active=dev）");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public String generateAccess(long userId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ACCESS_TTL)))
                .signWith(key)
                .compact();
    }

    /** 解析 access token，无效/过期返回 empty。 */
    public Optional<Long> parse(String token) {
        try {
            Claims claims = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(token).getPayload();
            return Optional.of(Long.parseLong(claims.getSubject()));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}

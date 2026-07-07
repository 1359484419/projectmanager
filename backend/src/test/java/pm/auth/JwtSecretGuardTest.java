package pm.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * JWT secret 启动守卫：非 dev profile 且 secret 为开发默认值 → 拒绝启动（fail-fast），
 * 防止生产误用默认 secret 签发可伪造的 token。
 */
class JwtSecretGuardTest {

    private static final String DEFAULT_SECRET = "dev-only-secret-change-me-0123456789abcdef";

    @Test
    void defaultSecret_withoutDevProfile_failsFast() {
        assertThatThrownBy(() -> new JwtService(DEFAULT_SECRET, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET");
    }

    @Test
    void defaultSecret_withDevProfile_boots() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("dev");
        assertThatCode(() -> new JwtService(DEFAULT_SECRET, env)).doesNotThrowAnyException();
    }

    @Test
    void strongSecret_withoutProfile_boots() {
        assertThatCode(() -> new JwtService("s".repeat(64), new MockEnvironment()))
                .doesNotThrowAnyException();
    }
}

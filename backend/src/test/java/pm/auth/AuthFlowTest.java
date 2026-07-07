package pm.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 认证全流程：注册（建租户+ADMIN）→ 用 token 查我的租户；
 * 错密码登录 401；slug 重复 409 SLUG_TAKEN；refresh 换新 token 对。
 */
class AuthFlowTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    private String uniq() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @SuppressWarnings("unchecked")
    void register_thenListTenants_roleIsAdmin() {
        String u = uniq();
        String slug = "acme-" + u;
        ResponseEntity<Map> reg = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com",
                "password", "secret123",
                "displayName", "User " + u,
                "tenantName", "Acme " + u,
                "tenantSlug", slug), Map.class);
        assertThat(reg.getStatusCode().value()).isEqualTo(200);
        String accessToken = (String) reg.getBody().get("accessToken");
        String refreshToken = (String) reg.getBody().get("refreshToken");
        assertThat(accessToken).isNotBlank();
        assertThat(refreshToken).isNotBlank();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<List> tenants = rest.exchange("/api/me/tenants", HttpMethod.GET,
                new HttpEntity<>(headers), List.class);
        assertThat(tenants.getStatusCode().value()).isEqualTo(200);
        Map<String, Object> t = (Map<String, Object>) tenants.getBody().get(0);
        assertThat(t.get("slug")).isEqualTo(slug);
        assertThat(t.get("name")).isEqualTo("Acme " + u);
        assertThat(t.get("role")).isEqualTo("ADMIN");
    }

    @Test
    @SuppressWarnings("unchecked")
    void login_wrongPassword_401_correctPassword_ok() {
        String u = uniq();
        rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U", "tenantName", "T" + u, "tenantSlug", "t-" + u), Map.class);

        ResponseEntity<Map> bad = rest.postForEntity("/api/auth/login",
                Map.of("email", u + "@example.com", "password", "wrong"), Map.class);
        assertThat(bad.getStatusCode().value()).isEqualTo(401);

        ResponseEntity<Map> ok = rest.postForEntity("/api/auth/login",
                Map.of("email", u + "@example.com", "password", "secret123"), Map.class);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertThat((String) ok.getBody().get("accessToken")).isNotBlank();
    }

    @Test
    @SuppressWarnings("unchecked")
    void register_duplicateSlug_409SlugTaken() {
        String u = uniq();
        String slug = "dup-" + u;
        rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U", "tenantName", "T", "tenantSlug", slug), Map.class);
        ResponseEntity<Map> second = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "2@example.com", "password", "secret123",
                "displayName", "U2", "tenantName", "T2", "tenantSlug", slug), Map.class);
        assertThat(second.getStatusCode().value()).isEqualTo(409);
        assertThat(second.getBody().get("code")).isEqualTo("SLUG_TAKEN");
    }

    @Test
    @SuppressWarnings("unchecked")
    void refresh_returnsNewTokenPair_oldRefreshRevoked() {
        String u = uniq();
        ResponseEntity<Map> reg = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U", "tenantName", "T" + u, "tenantSlug", "r-" + u), Map.class);
        String refreshToken = (String) reg.getBody().get("refreshToken");

        ResponseEntity<Map> refreshed = rest.postForEntity("/api/auth/refresh",
                Map.of("refreshToken", refreshToken), Map.class);
        assertThat(refreshed.getStatusCode().value()).isEqualTo(200);
        assertThat((String) refreshed.getBody().get("accessToken")).isNotBlank();
        assertThat((String) refreshed.getBody().get("refreshToken")).isNotBlank();

        // 旧 refresh token 已轮换失效
        ResponseEntity<Map> reuse = rest.postForEntity("/api/auth/refresh",
                Map.of("refreshToken", refreshToken), Map.class);
        assertThat(reuse.getStatusCode().value()).isEqualTo(401);
    }
}

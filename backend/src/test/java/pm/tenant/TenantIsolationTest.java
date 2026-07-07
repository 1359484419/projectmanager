package pm.tenant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 全项目安全底线：跨租户访问一律 404（不暴露资源存在性）。
 * 租户 A（用户 a）/ 租户 B（用户 b），b 打 A 的路径必须 404。
 */
class TenantIsolationTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    String slugA;
    String tokenA;
    String tokenB;

    @SuppressWarnings("unchecked")
    private String register(String slug) {
        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> resp = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U" + u, "tenantName", "T" + u, "tenantSlug", slug), Map.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return (String) resp.getBody().get("accessToken");
    }

    private ResponseEntity<Map> ping(String slug, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return rest.exchange("/api/t/" + slug + "/ping", HttpMethod.GET,
                new HttpEntity<>(headers), Map.class);
    }

    @BeforeEach
    void setUp() {
        slugA = "ta-" + UUID.randomUUID().toString().substring(0, 8);
        String slugB = "tb-" + UUID.randomUUID().toString().substring(0, 8);
        tokenA = register(slugA);
        tokenB = register(slugB);
    }

    @Test
    void memberOfTenant_ping_200_withTenantId() {
        ResponseEntity<Map> resp = ping(slugA, tokenA);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(((Number) resp.getBody().get("tenantId")).longValue()).isPositive();
    }

    @Test
    void nonMember_crossTenantAccess_404() {
        ResponseEntity<Map> resp = ping(slugA, tokenB);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
        assertThat(resp.getBody().get("code")).isEqualTo("NOT_FOUND");
    }

    @Test
    void unknownSlug_404() {
        ResponseEntity<Map> resp = ping("no-such-tenant", tokenA);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void unauthenticated_401() {
        ResponseEntity<Map> resp = rest.getForEntity("/api/t/" + slugA + "/ping", Map.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(401);
    }
}

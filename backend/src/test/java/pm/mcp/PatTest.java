package pm.mcp;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * PAT（个人访问令牌）：生成（明文一次性）、认证访问租户 API、吊销 401、跨租户 404。
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PatTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;

    @BeforeAll
    void setup() {
        fx = new TwoTenantsFixture(rest);
        // 租户 A 建一个项目，供 PAT 读取验证
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/projects", Map.of("key", "PAT", "name", "Pat Project"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
    }

    @SuppressWarnings("unchecked")
    @Test
    void patLifecycle() {
        // 1) 生成 token：明文只返回这一次，前缀 pmt_
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "cli", "tenantSlug", fx.slugA));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        String token = (String) created.getBody().get("token");
        Number tokenId = (Number) created.getBody().get("id");
        assertThat(token).startsWith("pmt_");
        assertThat(token.length()).isGreaterThanOrEqualTo(52); // pmt_ + 48 位随机

        // 2) 列表不回明文
        ResponseEntity<List> list = fx.getList(fx.adminTokenA, "/api/me/tokens");
        assertThat(list.getStatusCode().value()).isEqualTo(200);
        Map<String, Object> row = (Map<String, Object>) list.getBody().get(0);
        assertThat(row).doesNotContainKey("token");
        assertThat(row.get("tenantSlug")).isEqualTo(fx.slugA);

        // 3) 用 PAT 调租户 API → 200 且能看到项目
        ResponseEntity<List> projects = fx.getList(token, "/api/t/" + fx.slugA + "/projects");
        assertThat(projects.getStatusCode().value()).isEqualTo(200);
        assertThat(projects.getBody()).anySatisfy(o ->
                assertThat(((Map<String, Object>) o).get("key")).isEqualTo("PAT"));

        // 4) A 租户 PAT 打 B 租户路径 → 404
        ResponseEntity<Map> cross = fx.exchange(token, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/projects", null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);

        // 5) 吊销后 → 401
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                "/api/me/tokens/" + tokenId.longValue(), null);
        assertThat(del.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> after = fx.exchange(token, HttpMethod.GET,
                "/api/t/" + fx.slugA + "/projects", null);
        assertThat(after.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void cannotCreateTokenForTenantWithoutMembership() {
        // A 的用户对 B 租户无 membership → 404（不泄露存在性）
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "x", "tenantSlug", fx.slugB));
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }
}

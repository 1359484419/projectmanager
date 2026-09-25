package pm.mcp;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
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

    /**
     * 活动来源判定（RequestSource）：PAT 请求无论带不带 X-PM-Source 一律记 MCP；
     * 浏览器 JWT 伪造 X-PM-Source: MCP 不得被判为 MCP（记 WEB）。
     * 原由 McpToolsTest 在内置 SDK 服务上覆盖；/mcp 改反代后，Python 工具用同一 PAT 回调这些 REST 端点。
     */
    @SuppressWarnings("unchecked")
    @Test
    void patRequests_recordActivitySourceMcp_andJwtCannotForgeIt() {
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "src", "tenantSlug", fx.slugA));
        String pat = (String) created.getBody().get("token");

        // PAT + X-PM-Source: MCP（Python MCP 服务回调时会带）→ MCP
        ResponseEntity<Map> byPat = exchangeWithSource(pat, "MCP", "PAT 建的任务");
        assertThat(byPat.getStatusCode().value()).isEqualTo(200);
        assertThat(lastActivitySource(pat, ((Number) byPat.getBody().get("id")).longValue())).isEqualTo("MCP");

        // PAT 不带来源头 → 仍是 MCP
        ResponseEntity<Map> byPatNoHeader = fx.exchange(pat, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/projects/PAT/tasks", Map.of("type", "TASK", "title", "PAT 无头"));
        assertThat(byPatNoHeader.getStatusCode().value()).isEqualTo(200);
        assertThat(lastActivitySource(pat, ((Number) byPatNoHeader.getBody().get("id")).longValue()))
                .isEqualTo("MCP");

        // JWT 伪造 X-PM-Source: MCP → WEB
        ResponseEntity<Map> byJwt = exchangeWithSource(fx.adminTokenA, "MCP", "JWT 伪造来源");
        assertThat(byJwt.getStatusCode().value()).isEqualTo(200);
        assertThat(lastActivitySource(fx.adminTokenA, ((Number) byJwt.getBody().get("id")).longValue()))
                .isEqualTo("WEB");
    }

    private ResponseEntity<Map> exchangeWithSource(String bearer, String source, String title) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(bearer);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-PM-Source", source);
        return rest.exchange("/api/t/" + fx.slugA + "/projects/PAT/tasks", HttpMethod.POST,
                new HttpEntity<>(Map.of("type", "TASK", "title", title), headers), Map.class);
    }

    @SuppressWarnings("unchecked")
    private String lastActivitySource(String bearer, long taskId) {
        ResponseEntity<List> acts = fx.getList(bearer, "/api/t/" + fx.slugA + "/tasks/" + taskId + "/activities");
        assertThat(acts.getStatusCode().value()).isEqualTo(200);
        assertThat(acts.getBody()).isNotEmpty();
        Map<String, Object> last = (Map<String, Object>) acts.getBody().get(acts.getBody().size() - 1);
        return (String) last.get("source");
    }

    @Test
    void cannotCreateTokenForTenantWithoutMembership() {
        // A 的用户对 B 租户无 membership → 404（不泄露存在性）
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "x", "tenantSlug", fx.slugB));
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }
}

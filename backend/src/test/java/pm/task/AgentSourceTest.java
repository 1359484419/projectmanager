package pm.task;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
 * 活动来源判定（Review Focus 5）：
 * - JWT + X-PM-Source: AGENT → AGENT（助手回调）
 * - PAT + 同样的 header → 仍是 MCP，不能伪造成 AGENT
 * - 无 header → WEB；header 值不是 AGENT → WEB
 */
class AgentSourceTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    Object taskId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PM", "name", "demo"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "来源判定"));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        taskId = t.getBody().get("id");
    }

    /** 带自定义 header 的 PATCH。 */
    private ResponseEntity<Map> patch(String token, String sourceHeader, Map<String, ?> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (sourceHeader != null) {
            headers.set("X-PM-Source", sourceHeader);
        }
        return rest.exchange(base + "/tasks/" + taskId, HttpMethod.PATCH,
                new HttpEntity<>(body, headers), Map.class);
    }

    /** 最近一条活动的 source（活动流倒序）。 */
    @SuppressWarnings("unchecked")
    private String latestSource() {
        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + taskId + "/activities");
        assertThat(acts.getStatusCode().value()).isEqualTo(200);
        List<Map> list = acts.getBody();
        return (String) list.get(0).get("source");
    }

    @SuppressWarnings("unchecked")
    private String createPat() {
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "agent-test", "tenantSlug", fx.slugA));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        return (String) created.getBody().get("token");
    }

    @Test
    void jwtWithAgentHeader_recordsAgent() {
        ResponseEntity<Map> resp = patch(fx.adminTokenA, "AGENT", Map.of("status", "IN_PROGRESS"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(latestSource()).isEqualTo("AGENT");
    }

    @Test
    void patWithAgentHeader_cannotForge_staysMcp() {
        String pat = createPat();
        ResponseEntity<Map> resp = patch(pat, "AGENT", Map.of("status", "IN_PROGRESS"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(latestSource()).isEqualTo("MCP");
    }

    @Test
    void noHeader_recordsWeb() {
        ResponseEntity<Map> resp = patch(fx.adminTokenA, null, Map.of("status", "IN_PROGRESS"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(latestSource()).isEqualTo("WEB");
    }

    @Test
    void otherHeaderValue_recordsWeb() {
        // 只接受 AGENT 这一个值；JWT 请求自称 MCP 也不算
        ResponseEntity<Map> resp = patch(fx.adminTokenA, "MCP", Map.of("status", "IN_PROGRESS"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(latestSource()).isEqualTo("WEB");
    }
}

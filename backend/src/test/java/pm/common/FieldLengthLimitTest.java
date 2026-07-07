package pm.common;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 字段长度上限：task title≤200 / description≤10000、project name≤100、
 * epic name≤100 / description≤2000、comment body≤5000；超限 400 VALIDATION（中文文案）。
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FieldLengthLimitTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    Object taskId;

    @BeforeAll
    void setup() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "LEN", "name", "长度测试"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/tasks", Map.of("type", "TASK", "title", "基础任务"));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        taskId = t.getBody().get("id");
    }

    private static String repeat(int n) {
        return "字".repeat(n);
    }

    private void assertValidation(ResponseEntity<Map> resp, String limit) {
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("VALIDATION");
        assertThat((String) resp.getBody().get("message")).contains(limit);
    }

    @Test
    void taskTitle_over200_rejected_boundary200_ok() {
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/tasks", Map.of("type", "TASK", "title", repeat(201)));
        assertValidation(bad, "200");

        ResponseEntity<Map> ok = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/tasks", Map.of("type", "TASK", "title", repeat(200)));
        assertThat(ok.getStatusCode().value()).isEqualTo(200);

        // PATCH 同样受限
        ResponseEntity<Map> patch = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + taskId, Map.of("title", repeat(201)));
        assertValidation(patch, "200");
    }

    @Test
    void taskDescription_over10000_rejected() {
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/tasks",
                Map.of("type", "TASK", "title", "描述超限", "description", repeat(10001)));
        assertValidation(bad, "10000");

        ResponseEntity<Map> patch = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + taskId, Map.of("description", repeat(10001)));
        assertValidation(patch, "10000");
    }

    @Test
    void projectName_over100_rejected() {
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "LB", "name", repeat(101)));
        assertValidation(bad, "100");

        ResponseEntity<Map> patch = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/projects/LEN", Map.of("name", repeat(101)));
        assertValidation(patch, "100");
    }

    @Test
    void epicNameAndDescription_limits() {
        ResponseEntity<Map> badName = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/epics", Map.of("name", repeat(101)));
        assertValidation(badName, "100");

        ResponseEntity<Map> badDesc = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/epics",
                Map.of("name", "史诗", "description", repeat(2001)));
        assertValidation(badDesc, "2000");

        // PATCH 同样受限
        ResponseEntity<Map> epic = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/LEN/epics", Map.of("name", "可改史诗"));
        assertThat(epic.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> patch = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/projects/LEN/epics/" + epic.getBody().get("id"),
                Map.of("description", repeat(2001)));
        assertValidation(patch, "2000");
    }

    @Test
    void commentBody_over5000_rejected() {
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", repeat(5001)));
        assertValidation(bad, "5000");

        ResponseEntity<Map> ok = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", repeat(5000)));
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
    }
}

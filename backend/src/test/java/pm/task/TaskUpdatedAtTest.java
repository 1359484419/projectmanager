package pm.task;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** tasks.updated_at：创建即写，任何写路径都推进（日报按「今天改过什么」取数）。 */
class TaskUpdatedAtTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Test
    void updatedAt_setOnCreate_andBumpedOnPatch() throws InterruptedException {
        TwoTenantsFixture fx = new TwoTenantsFixture(rest);
        String base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects", Map.of("key", "PM", "name", "demo"));
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "t"));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        assertThat(created.getBody().get("updatedAt")).isNotNull();
        assertThat(created.getBody().get("doneAt")).isNull();
        Instant first = Instant.parse((String) created.getBody().get("updatedAt"));
        Instant createdAt = Instant.parse((String) created.getBody().get("createdAt"));
        assertThat(first).isAfterOrEqualTo(createdAt);

        Thread.sleep(20);
        ResponseEntity<Map> patched = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + created.getBody().get("id"), Map.of("title", "t2"));
        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        Instant second = Instant.parse((String) patched.getBody().get("updatedAt"));
        assertThat(second).isAfter(first);

        // 详情读回与写入一致
        ResponseEntity<Map> got = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + created.getBody().get("id"), null);
        assertThat(Instant.parse((String) got.getBody().get("updatedAt"))).isEqualTo(second);
    }
}

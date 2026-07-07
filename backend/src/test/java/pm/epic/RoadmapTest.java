package pm.epic;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
 * Epic 与季度路线图：donePoints 只认 DONE、quarter 分组降序（未指定季度最后）、格式校验。
 */
class RoadmapTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo")).getStatusCode().value()).isEqualTo(200);
    }

    private Map createEpic(Map<String, ?> body) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/epics", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private Map createTask(Object epicId, int points) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "STORY", "title", "t" + points, "points", points, "epicId", epicId));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void roadmap_donePointsOnlyCountsDone() {
        Map epic = createEpic(Map.of("name", "MVP", "quarter", "2026-Q3", "color", "#3b82f6"));
        Map done = createTask(epic.get("id"), 3);
        createTask(epic.get("id"), 5);
        // 3pt 任务推到 DONE
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + done.get("id"), Map.of("status", "DONE"))
                .getStatusCode().value()).isEqualTo(200);

        ResponseEntity<List> resp = fx.getList(fx.adminTokenA, base + "/projects/PM/roadmap");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        List<Map> groups = resp.getBody();
        assertThat(groups).hasSize(1);
        assertThat(groups.get(0).get("quarter")).isEqualTo("2026-Q3");
        List<Map> epics = (List<Map>) groups.get(0).get("epics");
        assertThat(epics).hasSize(1);
        Map e = epics.get(0);
        assertThat(e.get("name")).isEqualTo("MVP");
        assertThat(e.get("color")).isEqualTo("#3b82f6");
        assertThat(e.get("status")).isEqualTo("OPEN");
        assertThat(e.get("donePoints")).isEqualTo(3);
        assertThat(e.get("totalPoints")).isEqualTo(8);
        assertThat((List<Map>) e.get("tasks")).hasSize(2);
    }

    @Test
    void roadmap_groupsQuarterDesc_nullLast() {
        createEpic(Map.of("name", "无季度"));
        createEpic(Map.of("name", "Q1", "quarter", "2026-Q1"));
        createEpic(Map.of("name", "Q4", "quarter", "2026-Q4"));
        List<Map> groups = fx.getList(fx.adminTokenA, base + "/projects/PM/roadmap").getBody();
        assertThat(groups).extracting(g -> g.get("quarter"))
                .containsExactly("2026-Q4", "2026-Q1", null);
    }

    @Test
    void invalidQuarter_400() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/epics", Map.of("name", "bad", "quarter", "2026Q3"));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        ResponseEntity<Map> resp2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/epics", Map.of("name", "bad", "quarter", "2026-Q5"));
        assertThat(resp2.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void patchEpic_statusAndQuarter() {
        Map epic = createEpic(Map.of("name", "改我", "quarter", "2026-Q3"));
        ResponseEntity<Map> patched = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/projects/PM/epics/" + epic.get("id"),
                Map.of("status", "DONE", "quarter", "2026-Q4", "name", "改完"));
        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        assertThat(patched.getBody().get("status")).isEqualTo("DONE");
        assertThat(patched.getBody().get("quarter")).isEqualTo("2026-Q4");
        assertThat(patched.getBody().get("name")).isEqualTo("改完");
    }

    @Test
    void crossTenant_epicAndRoadmap_404() {
        Map epic = createEpic(Map.of("name", "隔离"));
        assertThat(fx.exchange(fx.adminTokenB, HttpMethod.GET,
                base + "/projects/PM/roadmap", null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                "/api/t/" + fx.slugB + "/projects/PM/epics/" + epic.get("id"),
                Map.of("name", "hack")).getStatusCode().value()).isEqualTo(404);
    }
}

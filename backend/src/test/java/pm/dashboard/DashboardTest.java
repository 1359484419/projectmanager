package pm.dashboard;

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
 * Dashboard 四态概览 + All Sprints（withTasks 含 CLOSED）+ 评论 API。
 */
class DashboardTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo"));
    }

    private long createTask(String title, int points, Long sprintId, String status) {
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "STORY", "title", title, "points", points));
        long id = ((Number) t.getBody().get("id")).longValue();
        if (sprintId != null) {
            fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id,
                    Map.of("sprintId", sprintId));
        }
        if (!"TODO".equals(status)) {
            fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id,
                    Map.of("status", status));
        }
        return id;
    }

    @Test
    void dashboard_noActiveSprint_returnsNullSprint() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/projects/PM/dashboard", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().get("sprint")).isNull();
    }

    @Test
    void dashboard_countsGroupsAndDonePct() {
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        long sprintId = ((Number) s.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + sprintId + "/start", null);

        createTask("todo", 2, sprintId, "TODO");
        createTask("doing", 3, sprintId, "IN_PROGRESS");
        createTask("completed", 1, sprintId, "COMPLETED");
        createTask("done", 3, sprintId, "DONE");
        createTask("backlog不算", 5, null, "TODO");

        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/projects/PM/dashboard", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);

        Map sprint = (Map) resp.getBody().get("sprint");
        assertThat(((Number) sprint.get("id")).longValue()).isEqualTo(sprintId);
        assertThat(sprint.get("endDate")).isNotNull();
        assertThat(((Number) sprint.get("daysLeft")).intValue()).isEqualTo(13); // 今天开始的 2 周

        Map counts = (Map) resp.getBody().get("counts");
        assertThat(counts.get("TODO")).isEqualTo(1);
        assertThat(counts.get("IN_PROGRESS")).isEqualTo(1);
        assertThat(counts.get("COMPLETED")).isEqualTo(1);
        assertThat(counts.get("DONE")).isEqualTo(1);

        // donePct 按 points：done 3 / 总 9
        assertThat(((Number) resp.getBody().get("donePct")).doubleValue())
                .isBetween(33.2, 33.4);

        Map groups = (Map) resp.getBody().get("groups");
        assertThat((List) groups.get("TODO")).hasSize(1);
        assertThat(((Map) ((List) groups.get("DONE")).get(0)).get("title")).isEqualTo("done");
    }

    @Test
    void allSprints_withTasks_includesClosedDesc() {
        ResponseEntity<Map> s1 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        long s1Id = ((Number) s1.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + s1Id + "/start", null);
        createTask("s1的任务", 2, s1Id, "TODO");
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + s1Id + "/close",
                Map.of("unfinished", "BACKLOG"));

        ResponseEntity<Map> s2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        long s2Id = ((Number) s2.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + s2Id + "/start", null);
        createTask("s2的任务", 3, s2Id, "TODO");

        ResponseEntity<List> resp = fx.getList(fx.adminTokenA,
                base + "/projects/PM/sprints?withTasks=true");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        List<Map> sprints = resp.getBody();
        assertThat(sprints).hasSize(2);
        // 倒序：最新在前
        assertThat(((Number) sprints.get(0).get("id")).longValue()).isEqualTo(s2Id);
        assertThat(sprints.get(1).get("status")).isEqualTo("CLOSED");
        assertThat((List) sprints.get(0).get("tasks")).hasSize(1);
        assertThat((List) sprints.get(1).get("tasks")).isEmpty(); // 未完成已退回 backlog
    }

    @Test
    void comments_postAndList() {
        long taskId = createTask("有评论", 1, null, "TODO");

        ResponseEntity<Map> post = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", "第一条评论"));
        assertThat(post.getStatusCode().value()).isEqualTo(200);
        assertThat(post.getBody().get("body")).isEqualTo("第一条评论");
        assertThat(post.getBody().get("authorId")).isNotNull();

        fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", "第二条"));

        ResponseEntity<List> list = fx.getList(fx.adminTokenA,
                base + "/tasks/" + taskId + "/comments");
        assertThat(list.getStatusCode().value()).isEqualTo(200);
        assertThat(list.getBody()).hasSize(2);
        assertThat(((Map) list.getBody().get(0)).get("body")).isEqualTo("第一条评论");

        // 空 body → 400；跨租户 → 404
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", " "));
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/tasks/" + taskId + "/comments", null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
    }
}

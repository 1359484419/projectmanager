package pm.integration;

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
 * 前后端联调缺口回归测试：前端 hooks.ts 依赖但后端最初缺失的三个端点。
 * 1. GET /api/t/{slug}/sprints/{id}/board   （Board 页四列数据）
 * 2. GET /api/t/{slug}/tasks/{id}           （TaskDrawer 任务详情）
 * 3. GET /api/t/{slug}/members              （成员列表：Admin 页 / assignee 下拉）
 */
class FrontendGapTest extends IntegrationTest {

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

    private long createTask(String title, int points) {
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "STORY", "title", title, "points", points));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        return ((Number) t.getBody().get("id")).longValue();
    }

    @Test
    void board_returnsSprintAndFourColumns() {
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        long sprintId = ((Number) s.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + sprintId + "/start", null);

        long todoId = createTask("todo任务", 2);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + todoId,
                Map.of("sprintId", sprintId));
        long doneId = createTask("done任务", 3);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + doneId,
                Map.of("sprintId", sprintId));
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + doneId,
                Map.of("status", "DONE"));

        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/sprints/" + sprintId + "/board", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);

        Map sprint = (Map) resp.getBody().get("sprint");
        assertThat(((Number) sprint.get("id")).longValue()).isEqualTo(sprintId);
        assertThat(sprint.get("status")).isEqualTo("ACTIVE");

        Map columns = (Map) resp.getBody().get("columns");
        assertThat(columns.keySet()).containsExactlyInAnyOrder(
                "TODO", "IN_PROGRESS", "COMPLETED", "DONE");
        assertThat((List) columns.get("TODO")).hasSize(1);
        assertThat((List) columns.get("IN_PROGRESS")).isEmpty();
        assertThat((List) columns.get("DONE")).hasSize(1);
        assertThat(((Map) ((List) columns.get("DONE")).get(0)).get("title")).isEqualTo("done任务");

        // 跨租户 → 404
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/sprints/" + sprintId + "/board", null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void taskDetail_returnsTaskView() {
        long id = createTask("详情任务", 5);

        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + id, null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().get("title")).isEqualTo("详情任务");
        assertThat(((Number) resp.getBody().get("points")).intValue()).isEqualTo(5);
        assertThat(resp.getBody().get("status")).isEqualTo("TODO");
        assertThat(resp.getBody().get("rank")).isNotNull();

        // 跨租户 → 404
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/tasks/" + id, null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void members_listsAdminAndMember() {
        fx.addMemberToA();

        ResponseEntity<List> resp = fx.getList(fx.adminTokenA, base + "/members");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        List<Map> members = resp.getBody();
        assertThat(members).hasSize(2);
        assertThat(members.stream().map(m -> (String) m.get("role")))
                .containsExactlyInAnyOrder("ADMIN", "MEMBER");
        Map first = members.get(0);
        assertThat(first.get("userId")).isNotNull();
        assertThat(first.get("displayName")).isNotNull();
        assertThat(first.get("email")).isNotNull();

        // B 租户成员列表不含 A 的人
        ResponseEntity<List> b = fx.getList(fx.adminTokenB, "/api/t/" + fx.slugB + "/members");
        assertThat(b.getStatusCode().value()).isEqualTo(200);
        assertThat(b.getBody()).hasSize(1);
    }
}

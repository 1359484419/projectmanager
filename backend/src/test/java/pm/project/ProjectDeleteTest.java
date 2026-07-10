package pm.project;

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
 * 项目删除 DELETE /api/t/{slug}/projects/{key}：
 * 仅租户 ADMIN（MEMBER → 403 FORBIDDEN）；不存在的 key → 404；
 * 级联删除项目全部数据：任务（含 activity/评论/子任务）、Sprint（含容量覆盖）、Epic，最后项目本身。
 */
class ProjectDeleteTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    long taskId;
    long sprintId;
    long epicId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        // 项目 + Epic + Sprint + 任务（挂 Sprint/Epic）+ 评论 + 子任务 + 容量覆盖，级联全覆盖
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "DEL", "name", "待删项目")).getStatusCode().value()).isEqualTo(200);
        epicId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/DEL/epics",
                Map.of("name", "epic1")));
        sprintId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/DEL/sprints", null));
        taskId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/DEL/tasks",
                Map.of("type", "TASK", "title", "任务1", "sprintId", sprintId, "epicId", epicId)));
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/comments", Map.of("body", "评论1"))
                .getStatusCode().value()).isEqualTo(200);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", "子任务1"))
                .getStatusCode().value()).isEqualTo(200);
        long adminUserId = ((Number) ((Map) fx.getList(fx.adminTokenA, base + "/members")
                .getBody().get(0)).get("userId")).longValue();
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.PUT,
                base + "/sprints/" + sprintId + "/capacity/" + adminUserId, Map.of("capacity", 3))
                .getStatusCode().value()).isEqualTo(200);
    }

    private static long idOf(ResponseEntity<Map> resp) {
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return ((Number) resp.getBody().get("id")).longValue();
    }

    @Test
    void adminDeletes_projectAndAllChildrenGone() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/projects/DEL", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(204);

        // 项目列表不再包含
        List<Map> projects = fx.getList(fx.adminTokenA, base + "/projects").getBody();
        assertThat(projects).noneSatisfy(p -> assertThat(p.get("key")).isEqualTo("DEL"));

        // 任务 / Sprint board / Sprint 列表 / Epic 列表 / backlog 全部 404
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/sprints/" + sprintId + "/board", null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/projects/DEL/sprints", null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/projects/DEL/epics", null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/projects/DEL/backlog", null).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void memberDeletes_403_projectKept() {
        String memberToken = fx.addMemberToA();
        ResponseEntity<Map> resp = fx.exchange(memberToken, HttpMethod.DELETE,
                base + "/projects/DEL", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(403);
        assertThat(resp.getBody().get("code")).isEqualTo("FORBIDDEN");

        // 项目与任务仍在
        List<Map> projects = fx.getList(fx.adminTokenA, base + "/projects").getBody();
        assertThat(projects).anySatisfy(p -> assertThat(p.get("key")).isEqualTo("DEL"));
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void deleteUnknownKey_404() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/projects/NOPE", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void otherTenantAdmin_cannotDelete_404_projectKept() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenB, HttpMethod.DELETE,
                base + "/projects/DEL", null);
        // 租户 B 的 admin 不是租户 A 成员 → 租户解析层 404
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
        List<Map> projects = fx.getList(fx.adminTokenA, base + "/projects").getBody();
        assertThat(projects).anySatisfy(p -> assertThat(p.get("key")).isEqualTo("DEL"));
    }
}

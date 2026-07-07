package pm.task;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 跨实体引用归属校验：sprintId/epicId 必须属于任务所在项目（跨项目/跨租户 → 400），
 * assigneeId 必须是本租户成员（外租户用户 → 400）；同项目引用与显式置空不受影响。
 */
class TaskReferenceIntegrityTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    long p1TaskId;
    long p1SprintId;
    long p1EpicId;
    long p2SprintId;
    long p2EpicId;
    long tenantBSprintId;
    long tenantBAdminUserId;
    long tenantAAdminUserId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        // 租户 A：项目 P1（任务/冲刺/史诗）与 P2（冲刺/史诗）
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PONE", "name", "one"));
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PTWO", "name", "two"));
        p1TaskId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/tasks", Map.of("type", "TASK", "title", "P1 任务")));
        p1SprintId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/sprints", Map.of()));
        p1EpicId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/epics", Map.of("name", "P1 史诗")));
        p2SprintId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PTWO/sprints", Map.of()));
        p2EpicId = idOf(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PTWO/epics", Map.of("name", "P2 史诗")));
        // 租户 B：一个冲刺（跨租户引用目标）
        fx.exchange(fx.adminTokenB, HttpMethod.POST, "/api/t/" + fx.slugB + "/projects",
                Map.of("key", "PB", "name", "b"));
        tenantBSprintId = idOf(fx.exchange(fx.adminTokenB, HttpMethod.POST,
                "/api/t/" + fx.slugB + "/projects/PB/sprints", Map.of()));
        tenantBAdminUserId = memberUserId(fx.adminTokenB, fx.slugB);
        tenantAAdminUserId = memberUserId(fx.adminTokenA, fx.slugA);
    }

    private static long idOf(ResponseEntity<Map> resp) {
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return ((Number) resp.getBody().get("id")).longValue();
    }

    @SuppressWarnings("unchecked")
    private long memberUserId(String token, String slug) {
        List<Map> members = fx.getList(token, "/api/t/" + slug + "/members").getBody();
        return ((Number) members.get(0).get("userId")).longValue();
    }

    private ResponseEntity<Map> patch(Map<String, ?> body) {
        return fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + p1TaskId, body);
    }

    @Test
    void patchSprintId_otherProjectSameTenant_400() {
        ResponseEntity<Map> resp = patch(Map.of("sprintId", p2SprintId));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("INVALID_SPRINT");
    }

    @Test
    void patchSprintId_otherTenant_400() {
        ResponseEntity<Map> resp = patch(Map.of("sprintId", tenantBSprintId));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("INVALID_SPRINT");
    }

    @Test
    void patchEpicId_otherProject_400() {
        ResponseEntity<Map> resp = patch(Map.of("epicId", p2EpicId));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("INVALID_EPIC");
    }

    @Test
    void patchAssigneeId_userOutsideTenant_400() {
        ResponseEntity<Map> resp = patch(Map.of("assigneeId", tenantBAdminUserId));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("INVALID_ASSIGNEE");
    }

    @Test
    void createTask_crossProjectOrTenantRefs_400() {
        ResponseEntity<Map> badSprint = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/tasks",
                Map.of("type", "TASK", "title", "bad", "sprintId", p2SprintId));
        assertThat(badSprint.getStatusCode().value()).isEqualTo(400);
        assertThat(badSprint.getBody().get("code")).isEqualTo("INVALID_SPRINT");

        ResponseEntity<Map> badEpic = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/tasks",
                Map.of("type", "TASK", "title", "bad", "epicId", p2EpicId));
        assertThat(badEpic.getStatusCode().value()).isEqualTo(400);
        assertThat(badEpic.getBody().get("code")).isEqualTo("INVALID_EPIC");

        ResponseEntity<Map> badAssignee = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/tasks",
                Map.of("type", "TASK", "title", "bad", "assigneeId", tenantBAdminUserId));
        assertThat(badAssignee.getStatusCode().value()).isEqualTo(400);
        assertThat(badAssignee.getBody().get("code")).isEqualTo("INVALID_ASSIGNEE");
    }

    @Test
    void sameProjectRefs_andExplicitNull_stillWork() {
        ResponseEntity<Map> ok = patch(Map.of(
                "sprintId", p1SprintId, "epicId", p1EpicId, "assigneeId", tenantAAdminUserId));
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertThat(((Number) ok.getBody().get("sprintId")).longValue()).isEqualTo(p1SprintId);
        assertThat(((Number) ok.getBody().get("epicId")).longValue()).isEqualTo(p1EpicId);
        assertThat(((Number) ok.getBody().get("assigneeId")).longValue()).isEqualTo(tenantAAdminUserId);

        // 显式置空（移回 Backlog / 摘除 Epic / 取消指派）不受校验影响
        Map<String, Object> nulls = new HashMap<>();
        nulls.put("sprintId", null);
        nulls.put("epicId", null);
        nulls.put("assigneeId", null);
        ResponseEntity<Map> cleared = patch(nulls);
        assertThat(cleared.getStatusCode().value()).isEqualTo(200);
        assertThat(cleared.getBody().get("sprintId")).isNull();
        assertThat(cleared.getBody().get("epicId")).isNull();
        assertThat(cleared.getBody().get("assigneeId")).isNull();

        // 同项目引用建任务成功
        ResponseEntity<Map> createOk = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PONE/tasks", Map.of("type", "TASK", "title", "ok",
                        "sprintId", p1SprintId, "epicId", p1EpicId, "assigneeId", tenantAAdminUserId));
        assertThat(createOk.getStatusCode().value()).isEqualTo(200);
    }
}

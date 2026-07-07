package pm.sprint;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Sprint 生命周期（手动）+ 容量：
 * 默认周期/命名、ACTIVE 唯一 409、close 任务流转写 activity、
 * capacity 工作日数 + override + assignedPoints、跨租户 404。
 */
class SprintLifecycleTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PM", "name", "demo"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
    }

    private Map createSprint(Map<String, ?> body) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private Map createTask(String title, Number points) {
        Map<String, Object> body = points == null
                ? Map.of("type", "TASK", "title", title)
                : Map.of("type", "TASK", "title", title, "points", points);
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void createSprint_defaults_twoWeeks_sequentialNames() {
        Map s1 = createSprint(Map.of());
        assertThat(s1.get("name")).isEqualTo("Sprint 1");
        assertThat(s1.get("length")).isEqualTo("WEEK_2");
        assertThat(s1.get("status")).isEqualTo("PLANNED");
        LocalDate start = LocalDate.parse((String) s1.get("startDate"));
        LocalDate end = LocalDate.parse((String) s1.get("endDate"));
        assertThat(end).isEqualTo(start.plusDays(13));

        Map s2 = createSprint(Map.of("length", "WEEK_1", "startDate", "2026-07-06"));
        assertThat(s2.get("name")).isEqualTo("Sprint 2");
        assertThat(s2.get("endDate")).isEqualTo("2026-07-12");
    }

    @Test
    void startSecondSprint_conflicts409() {
        Map s1 = createSprint(Map.of());
        Map s2 = createSprint(Map.of());
        ResponseEntity<Map> start1 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + s1.get("id") + "/start", null);
        assertThat(start1.getStatusCode().value()).isEqualTo(200);
        assertThat(start1.getBody().get("status")).isEqualTo("ACTIVE");

        ResponseEntity<Map> start2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + s2.get("id") + "/start", null);
        assertThat(start2.getStatusCode().value()).isEqualTo(409);
        assertThat(start2.getBody().get("code")).isEqualTo("ACTIVE_SPRINT_EXISTS");
    }

    @Test
    void close_backlogOption_movesUnfinishedAndWritesActivity() {
        Map s1 = createSprint(Map.of());
        Object sprintId = s1.get("id");
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + sprintId + "/start", null);

        Map task = createTask("未完成", 3);
        Object taskId = task.get("id");
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + taskId,
                Map.of("sprintId", sprintId));

        ResponseEntity<Map> close = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + sprintId + "/close", Map.of("unfinished", "BACKLOG"));
        assertThat(close.getStatusCode().value()).isEqualTo(200);
        assertThat(close.getBody().get("status")).isEqualTo("CLOSED");

        // 任务回到 backlog（sprint_id 为 null，backlog 列表可见）
        ResponseEntity<List> backlog = fx.getList(fx.adminTokenA, base + "/projects/PM/backlog");
        assertThat(backlog.getBody()).extracting(t -> ((Map) t).get("id")).contains(taskId);

        // activities 含两条 SPRINT_CHANGED（移入 + 移出）
        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + taskId + "/activities");
        List<Map> sprintChanged = ((List<Map>) acts.getBody()).stream()
                .filter(a -> "SPRINT_CHANGED".equals(a.get("type"))).toList();
        assertThat(sprintChanged).hasSize(2);
        assertThat(sprintChanged.get(0).get("newValue")).isNull(); // 最新一条：移出到 backlog
    }

    @Test
    void close_moveOption_movesUnfinishedToTargetSprint() {
        Map s1 = createSprint(Map.of());
        Map s2 = createSprint(Map.of());
        Object s1Id = s1.get("id");
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + s1Id + "/start", null);

        Map task = createTask("要搬走", null);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + task.get("id"),
                Map.of("sprintId", s1Id));

        ResponseEntity<Map> close = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + s1Id + "/close",
                Map.of("unfinished", "MOVE", "targetSprintId", s2.get("id")));
        assertThat(close.getStatusCode().value()).isEqualTo(200);

        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + task.get("id"), Map.of());
        assertThat(t.getBody().get("sprintId")).isEqualTo(s2.get("id"));
    }

    @Test
    void capacity_workdays_override_assignedPoints() {
        // 2026-07-06(一) ~ 2026-07-19(日)：10 个工作日
        Map s1 = createSprint(Map.of("startDate", "2026-07-06"));
        Object sprintId = s1.get("id");

        ResponseEntity<List> cap = fx.getList(fx.adminTokenA, base + "/sprints/" + sprintId + "/capacity");
        assertThat(cap.getStatusCode().value()).isEqualTo(200);
        assertThat(cap.getBody()).hasSize(1); // 租户 A 只有 admin 一人
        Map row = (Map) cap.getBody().get(0);
        assertThat(row.get("capacity")).isEqualTo(10);
        assertThat(((Number) row.get("assignedPoints")).doubleValue()).isEqualTo(0.0);
        Object userId = row.get("userId");
        assertThat(row.get("displayName")).isNotNull();

        // override 成 8
        ResponseEntity<Map> put = fx.exchange(fx.adminTokenA, HttpMethod.PUT,
                base + "/sprints/" + sprintId + "/capacity/" + userId, Map.of("capacity", 8));
        assertThat(put.getStatusCode().value()).isEqualTo(200);

        // 指派两个任务 3 + 2.5 pt（小数求和）
        Map t1 = createTask("a", 3);
        Map t2 = createTask("b", 2.5);
        for (Object tid : List.of(t1.get("id"), t2.get("id"))) {
            fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + tid,
                    Map.of("sprintId", sprintId, "assigneeId", userId));
        }

        ResponseEntity<List> cap2 = fx.getList(fx.adminTokenA, base + "/sprints/" + sprintId + "/capacity");
        Map row2 = (Map) cap2.getBody().get(0);
        assertThat(row2.get("capacity")).isEqualTo(8);
        assertThat(((Number) row2.get("assignedPoints")).doubleValue()).isEqualTo(5.5);

        // 重复 PUT 幂等（upsert）
        ResponseEntity<Map> put2 = fx.exchange(fx.adminTokenA, HttpMethod.PUT,
                base + "/sprints/" + sprintId + "/capacity/" + userId, Map.of("capacity", 6));
        assertThat(put2.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<List> cap3 = fx.getList(fx.adminTokenA, base + "/sprints/" + sprintId + "/capacity");
        assertThat(((Map) cap3.getBody().get(0)).get("capacity")).isEqualTo(6);
    }

    @Test
    void crossTenant_sprintAccess_is404() {
        Map s1 = createSprint(Map.of());
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenB, HttpMethod.POST,
                "/api/t/" + fx.slugB + "/sprints/" + s1.get("id") + "/start", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }
}

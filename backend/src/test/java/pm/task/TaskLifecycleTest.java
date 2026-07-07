package pm.task;

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
 * 任务生命周期：默认 TODO / rank 尾插 / seq 递增；四态流转与 done_at；
 * activities 记录；backlog 按 rank 排序；跨租户 404。
 */
class TaskLifecycleTest extends IntegrationTest {

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

    private Map createTask(String title) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", title));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private Map patchTask(Object id, Map<String, ?> body) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void createTask_defaults_seqIncrements_rankAppends() {
        Map t1 = createTask("第一个");
        Map t2 = createTask("第二个");
        assertThat(t1.get("status")).isEqualTo("TODO");
        assertThat(t1.get("seq")).isEqualTo(1);
        assertThat(t2.get("seq")).isEqualTo(2);
        assertThat((String) t1.get("displayKey")).isEqualTo("PM-1");
        assertThat((String) t2.get("rank")).isGreaterThan((String) t1.get("rank"));
        assertThat(t1.get("doneAt")).isNull();
    }

    @Test
    void fourStateFlow_doneAt_and_activities() {
        Map t = createTask("流转");
        Object id = t.get("id");
        patchTask(id, Map.of("status", "IN_PROGRESS"));
        patchTask(id, Map.of("status", "COMPLETED"));
        Map done = patchTask(id, Map.of("status", "DONE"));
        assertThat(done.get("status")).isEqualTo("DONE");
        assertThat(done.get("doneAt")).isNotNull();
        // DONE 回退 COMPLETED → done_at 清空
        Map back = patchTask(id, Map.of("status", "COMPLETED"));
        assertThat(back.get("status")).isEqualTo("COMPLETED");
        assertThat(back.get("doneAt")).isNull();
        // activities：1 条 CREATED + 4 条 STATUS_CHANGED，倒序
        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + id + "/activities");
        assertThat(acts.getStatusCode().value()).isEqualTo(200);
        List<Map> list = acts.getBody();
        List<Map> statusChanged = list.stream()
                .filter(a -> "STATUS_CHANGED".equals(a.get("type"))).toList();
        assertThat(statusChanged).hasSize(4);
        // 倒序：第一条是最近的 DONE→COMPLETED
        assertThat(statusChanged.get(0).get("oldValue")).isEqualTo("DONE");
        assertThat(statusChanged.get(0).get("newValue")).isEqualTo("COMPLETED");
        assertThat(list.stream().filter(a -> "CREATED".equals(a.get("type")))).hasSize(1);
        assertThat(list.get(list.size() - 1).get("type")).isEqualTo("CREATED");
        assertThat(list.get(0).get("source")).isEqualTo("WEB");
    }

    @Test
    void backlog_orderedByRank_reorderByPatch() {
        Map t1 = createTask("a");
        Map t2 = createTask("b");
        Map t3 = createTask("c");
        // 把 t3 移到 t1 与 t2 之间
        patchTask(t3.get("id"), Map.of("rank",
                Map.of("afterTaskId", t1.get("id"), "beforeTaskId", t2.get("id"))));
        ResponseEntity<List> backlog = fx.getList(fx.adminTokenA, base + "/projects/PM/backlog");
        assertThat(backlog.getStatusCode().value()).isEqualTo(200);
        List<Map> list = backlog.getBody();
        assertThat(list).extracting(m -> m.get("title")).containsExactly("a", "c", "b");
        // 把 t2 移到最前
        patchTask(t2.get("id"), Map.of("rank", Map.of("beforeTaskId", t1.get("id"))));
        List<Map> list2 = fx.getList(fx.adminTokenA, base + "/projects/PM/backlog").getBody();
        assertThat(list2).extracting(m -> m.get("title")).containsExactly("b", "a", "c");
    }

    @Test
    void pointsAndAssigneeChange_recorded() {
        Map t = createTask("估点");
        Object id = t.get("id");
        Map updated = patchTask(id, Map.of("points", 5));
        assertThat(((Number) updated.get("points")).doubleValue()).isEqualTo(5.0);
        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + id + "/activities");
        assertThat((List<Map>) acts.getBody()).anyMatch(a ->
                "POINTS_CHANGED".equals(a.get("type")) && "5".equals(a.get("newValue")));
        // 非法 points → 400
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("points", 0));
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void points_acceptsHalfSteps_rejectsOutOfRangeOrOffStep() {
        Map t = createTask("小数估点");
        Object id = t.get("id");
        // 0.5 的倍数、0.5-5 区间 → 合法
        Map half = patchTask(id, Map.of("points", 2.5));
        assertThat(((Number) half.get("points")).doubleValue()).isEqualTo(2.5);
        // 详情回读也是 2.5
        ResponseEntity<Map> detail = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + id, null);
        assertThat(((Number) detail.getBody().get("points")).doubleValue()).isEqualTo(2.5);
        // 非 0.5 倍数 → 400 INVALID_POINTS
        ResponseEntity<Map> offStep = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("points", 0.3));
        assertThat(offStep.getStatusCode().value()).isEqualTo(400);
        assertThat(offStep.getBody().get("code")).isEqualTo("INVALID_POINTS");
        // 超上限 → 400 INVALID_POINTS
        ResponseEntity<Map> tooBig = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("points", 5.5));
        assertThat(tooBig.getStatusCode().value()).isEqualTo(400);
        assertThat(tooBig.getBody().get("code")).isEqualTo("INVALID_POINTS");
        // 低于下限 → 400 INVALID_POINTS
        ResponseEntity<Map> tooSmall = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("points", 0.25));
        assertThat(tooSmall.getStatusCode().value()).isEqualTo(400);
        assertThat(tooSmall.getBody().get("code")).isEqualTo("INVALID_POINTS");
        // 创建时同样校验
        ResponseEntity<Map> badCreate = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", "bad", "points", 6));
        assertThat(badCreate.getStatusCode().value()).isEqualTo(400);
        assertThat(badCreate.getBody().get("code")).isEqualTo("INVALID_POINTS");
        ResponseEntity<Map> okCreate = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", "ok", "points", 0.5));
        assertThat(okCreate.getStatusCode().value()).isEqualTo(200);
        assertThat(((Number) okCreate.getBody().get("points")).doubleValue()).isEqualTo(0.5);
    }

    @Test
    void crossTenant_taskAccess_404() {
        Map t = createTask("隔离");
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                "/api/t/" + fx.slugA + "/tasks/" + t.get("id"), Map.of("status", "DONE"));
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
        // 用 B 自己的租户路径打 A 的任务 id → 404（filter 隔离）
        ResponseEntity<Map> crossOwnPath = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                "/api/t/" + fx.slugB + "/tasks/" + t.get("id"), Map.of("status", "DONE"));
        assertThat(crossOwnPath.getStatusCode().value()).isEqualTo(404);
    }
}

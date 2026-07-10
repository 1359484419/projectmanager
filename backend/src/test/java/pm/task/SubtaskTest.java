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
 * 子任务：增删改查、done 切换、标题校验（空白/超长 400）、
 * 删主任务级联删子任务、跨租户隔离 404。
 */
class SubtaskTest extends IntegrationTest {

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
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "主任务"));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        taskId = t.getBody().get("id");
    }

    private Map createSubtask(String title) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", title));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private List<Map> listSubtasks() {
        ResponseEntity<List> resp = fx.getList(fx.adminTokenA,
                base + "/tasks/" + taskId + "/subtasks");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void crud_andDoneToggle() {
        // 创建：默认未完成，按 id 升序列出
        Map s1 = createSubtask("写文档");
        Map s2 = createSubtask("补测试");
        assertThat(s1.get("done")).isEqualTo(false);
        assertThat(s1.get("taskId")).isEqualTo(taskId);
        assertThat(s1.get("createdAt")).isNotNull();
        List<Map> list = listSubtasks();
        assertThat(list).extracting(m -> m.get("title")).containsExactly("写文档", "补测试");

        // done 切换：false → true → false
        ResponseEntity<Map> done = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s1.get("id"), Map.of("done", true));
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(done.getBody().get("done")).isEqualTo(true);
        ResponseEntity<Map> undone = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s1.get("id"), Map.of("done", false));
        assertThat(undone.getBody().get("done")).isEqualTo(false);

        // 改标题
        ResponseEntity<Map> renamed = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s2.get("id"), Map.of("title", "补集成测试"));
        assertThat(renamed.getStatusCode().value()).isEqualTo(200);
        assertThat(renamed.getBody().get("title")).isEqualTo("补集成测试");

        // 删除 → 204，列表只剩一条
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/subtasks/" + s1.get("id"), null);
        assertThat(del.getStatusCode().value()).isEqualTo(204);
        assertThat(listSubtasks()).extracting(m -> m.get("title")).containsExactly("补集成测试");
    }

    @Test
    void titleValidation_blankAndTooLong_400() {
        // 创建：空白标题 → 400
        ResponseEntity<Map> blank = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", "   "));
        assertThat(blank.getStatusCode().value()).isEqualTo(400);
        // 创建：超 200 字符 → 400
        ResponseEntity<Map> tooLong = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", "a".repeat(201)));
        assertThat(tooLong.getStatusCode().value()).isEqualTo(400);
        assertThat(tooLong.getBody().get("code")).isEqualTo("VALIDATION");
        // PATCH：空白标题 → 400
        Map s = createSubtask("正常");
        ResponseEntity<Map> patchBlank = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("title", " "));
        assertThat(patchBlank.getStatusCode().value()).isEqualTo(400);
        // 不存在的主任务 → 404
        ResponseEntity<Map> noTask = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/999999/subtasks", Map.of("title", "x"));
        assertThat(noTask.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void deleteTask_cascadesSubtasks() {
        createSubtask("会被级联删");
        // 删主任务
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/tasks/" + taskId, null);
        assertThat(del.getStatusCode().value()).isEqualTo(204);
        // 主任务没了 → 子任务列表 404（挂在已删任务下；404 响应体是错误对象，用 Map 接）
        ResponseEntity<Map> list = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId + "/subtasks", null);
        assertThat(list.getStatusCode().value()).isEqualTo(404);
        // 再建一个同项目任务，确认库里不会串（新任务子任务为空）
        ResponseEntity<Map> t2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "新任务"));
        ResponseEntity<List> empty = fx.getList(fx.adminTokenA,
                base + "/tasks/" + t2.getBody().get("id") + "/subtasks");
        assertThat(empty.getBody()).isEmpty();
    }

    @Test
    void crossTenant_isolation_404() {
        Map s = createSubtask("隔离");
        // B 租户走 A 的路径 → 404（404 响应体是错误对象，用 Map 接）
        ResponseEntity<Map> crossList = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                base + "/tasks/" + taskId + "/subtasks", null);
        assertThat(crossList.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<Map> crossPatch = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("done", true));
        assertThat(crossPatch.getStatusCode().value()).isEqualTo(404);
        // B 用自己的租户路径打 A 的 subtask id → 404（tenant_id 过滤）
        ResponseEntity<Map> crossOwnPath = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                "/api/t/" + fx.slugB + "/subtasks/" + s.get("id"), Map.of("done", true));
        assertThat(crossOwnPath.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<Map> crossDelete = fx.exchange(fx.adminTokenB, HttpMethod.DELETE,
                "/api/t/" + fx.slugB + "/subtasks/" + s.get("id"), null);
        assertThat(crossDelete.getStatusCode().value()).isEqualTo(404);
        // A 的数据未被影响
        assertThat(listSubtasks()).hasSize(1);
        assertThat(listSubtasks().get(0).get("done")).isEqualTo(false);
    }
}

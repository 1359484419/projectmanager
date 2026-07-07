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
 * ① PATCH 置空语义（sprintId/assigneeId 显式 null = 清空，字段缺省 = 不动）；
 * ② 全租户关键词搜索（跨项目/负责人、大小写不敏感、租户隔离）。
 */
class PatchNullAndSearchTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PS", "name", "搜索测试"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> createTask(Map<String, Object> body) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PS/tasks", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void patchNullSprint_movesBackToBacklog_absentFieldUntouched() {
        Map<String, Object> sprint = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PS/sprints", Map.of()).getBody();
        Number sprintId = (Number) sprint.get("id");

        Map<String, Object> task = createTask(Map.of(
                "type", "STORY", "title", "移回测试", "sprintId", sprintId));
        Number taskId = (Number) task.get("id");
        assertThat(task.get("sprintId")).as("create resp: %s, sprint resp: %s", task, sprint)
                .isNotNull();

        // 只改标题（sprintId 字段缺省）→ sprint 归属不动
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + taskId,
                Map.of("title", "移回测试2"));
        Map<String, Object> afterTitle = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null).getBody();
        assertThat(afterTitle.get("sprintId")).isNotNull();

        // 显式 sprintId:null → 移回 Backlog
        Map<String, Object> clear = new HashMap<>();
        clear.put("sprintId", null);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + taskId, clear);
        Map<String, Object> afterClear = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null).getBody();
        assertThat(afterClear.get("sprintId")).isNull();

        // 有 SPRINT_CHANGED 留痕（new=null）
        List<Map<String, Object>> acts = fx.getList(fx.adminTokenA,
                base + "/tasks/" + taskId + "/activities").getBody();
        assertThat(acts.stream().anyMatch(a -> "SPRINT_CHANGED".equals(a.get("type"))
                && a.get("newValue") == null)).isTrue();
    }

    @Test
    void patchNullAssignee_clearsAssignee() {
        List<Map<String, Object>> members = fx.getList(fx.adminTokenA, base + "/members").getBody();
        Number userId = (Number) members.get(0).get("userId");

        Map<String, Object> task = createTask(Map.of(
                "type", "TASK", "title", "指派清空", "assigneeId", userId));
        Number taskId = (Number) task.get("id");

        Map<String, Object> clear = new HashMap<>();
        clear.put("assigneeId", null);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + taskId, clear);
        Map<String, Object> after = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null).getBody();
        assertThat(after.get("assigneeId")).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void search_matchesTitleAndDescription_caseInsensitive_tenantIsolated() {
        createTask(Map.of("type", "STORY", "title", "登录支持 OAuth",
                "description", "接入 Google 与 GitHub 第三方登录"));
        createTask(Map.of("type", "BUG", "title", "看板拖拽丢卡",
                "description", "空列拖入时登录态丢失"));
        createTask(Map.of("type", "TASK", "title", "无关任务"));

        List<Map<String, Object>> hits = fx.getList(fx.adminTokenA,
                base + "/tasks/search?q=登录").getBody();
        assertThat(hits).hasSize(2);
        assertThat(hits.get(0)).containsKeys("displayKey", "projectKey", "title", "status");

        // 大小写不敏感
        List<Map<String, Object>> oauth = fx.getList(fx.adminTokenA,
                base + "/tasks/search?q=oauth").getBody();
        assertThat(oauth).hasSize(1);
        assertThat((String) oauth.get(0).get("title")).contains("OAuth");

        // 描述摘要随结果返回
        assertThat((String) oauth.get(0).get("description")).contains("Google");

        // 租户 B 搜同词 → 空（隔离）
        List<Map<String, Object>> other = fx.getList(fx.adminTokenB,
                "/api/t/" + fx.slugB + "/tasks/search?q=登录").getBody();
        assertThat(other).isEmpty();

        // B 的 token 打 A 的搜索路径 → 404
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                base + "/tasks/search?q=登录", null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
    }
}

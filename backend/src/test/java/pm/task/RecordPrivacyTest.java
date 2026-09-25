package pm.task;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RECORD 私有性（审查报告 P0）：记录是创建者私有数据，
 * 不能带 sprintId/assigneeId/epicId（400 INVALID_RECORD_FIELD），
 * 即使库里有历史脏数据挂进了迭代/Epic，看板/迭代列表/仪表盘/路线图也一律不显示。
 */
class RecordPrivacyTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    JdbcTemplate jdbc;

    TwoTenantsFixture fx;
    String base;
    Object sprintId;
    Object epicId;
    Object adminUserId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo")).getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> sprint = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        sprintId = sprint.getBody().get("id");
        ResponseEntity<Map> epic = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/epics", Map.of("name", "长期计划", "quarter", "2026-Q3"));
        epicId = epic.getBody().get("id");
        ResponseEntity<List> members = fx.getList(fx.adminTokenA, base + "/members");
        adminUserId = ((Map) members.getBody().get(0)).get("userId");
    }

    private ResponseEntity<Map> createRecord(Map<String, Object> extra) {
        Map<String, Object> body = new java.util.HashMap<>(Map.of("type", "RECORD", "title", "私密记录"));
        body.putAll(extra);
        return fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/PM/tasks", body);
    }

    @Test
    void createRecord_withSprintAssigneeOrEpic_400() {
        for (Map<String, Object> extra : List.of(
                Map.<String, Object>of("sprintId", sprintId),
                Map.<String, Object>of("assigneeId", adminUserId),
                Map.<String, Object>of("epicId", epicId))) {
            ResponseEntity<Map> resp = createRecord(extra);
            assertThat(resp.getStatusCode().value()).as("extra=%s", extra).isEqualTo(400);
            assertThat(resp.getBody().get("code")).isEqualTo("INVALID_RECORD_FIELD");
        }
    }

    @Test
    void patchRecord_withSprintAssigneeOrEpic_400_andNullIsFine() {
        ResponseEntity<Map> created = createRecord(Map.of());
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        Object id = created.getBody().get("id");
        for (Map<String, Object> patch : List.of(
                Map.<String, Object>of("sprintId", sprintId),
                Map.<String, Object>of("assigneeId", adminUserId),
                Map.<String, Object>of("epicId", epicId))) {
            ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                    base + "/tasks/" + id, patch);
            assertThat(resp.getStatusCode().value()).as("patch=%s", patch).isEqualTo(400);
            assertThat(resp.getBody().get("code")).isEqualTo("INVALID_RECORD_FIELD");
        }
        // 显式置空不算违规（幂等），改标题照常
        Map<String, Object> nulls = new java.util.HashMap<>();
        nulls.put("sprintId", null);
        nulls.put("title", "改名的记录");
        ResponseEntity<Map> ok = fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id, nulls);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertThat(ok.getBody().get("title")).isEqualTo("改名的记录");
    }

    /**
     * 审查 2026-09-25 完善度 #1：子任务 id 全局自增可枚举，/subtasks/{id} 不能成为绕过 RECORD 私有性的旁路。
     * 他人 PATCH/DELETE 记录的子任务一律 404（伪装不存在），且数据不变；主人自己照常可改。
     */
    @Test
    void othersCannotPatchOrDeleteSubtaskOfPrivateRecord() {
        ResponseEntity<Map> created = createRecord(Map.of());
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        Object recordId = created.getBody().get("id");
        ResponseEntity<Map> sub = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + recordId + "/subtasks", Map.of("title", "SECRET subtask"));
        assertThat(sub.getStatusCode().value()).isEqualTo(200);
        Object subId = sub.getBody().get("id");

        String memberToken = fx.addMemberToA();
        ResponseEntity<Map> patch = fx.exchange(memberToken, HttpMethod.PATCH,
                base + "/subtasks/" + subId, Map.of("done", true, "title", "hacked"));
        assertThat(patch.getStatusCode().value()).isEqualTo(404);
        assertThat(String.valueOf(patch.getBody())).doesNotContain("SECRET");
        ResponseEntity<Map> del = fx.exchange(memberToken, HttpMethod.DELETE, base + "/subtasks/" + subId, null);
        assertThat(del.getStatusCode().value()).isEqualTo(404);

        // 主人视角：子任务仍在且未被改动
        ResponseEntity<List> mine = fx.getList(fx.adminTokenA, base + "/tasks/" + recordId + "/subtasks");
        assertThat(mine.getBody()).hasSize(1);
        Map row = (Map) mine.getBody().get(0);
        assertThat(row.get("title")).isEqualTo("SECRET subtask");
        assertThat(row.get("done")).isEqualTo(false);
        // 主人自己照常可改/可删
        ResponseEntity<Map> own = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + subId, Map.of("done", true));
        assertThat(own.getStatusCode().value()).isEqualTo(200);
        assertThat(own.getBody().get("done")).isEqualTo(true);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.DELETE, base + "/subtasks/" + subId, null)
                .getStatusCode().value()).isEqualTo(204);
    }

    /**
     * 审查 2026-09-25 完善度 #2：dismiss 只能关自己记录的提醒。他人 dismiss → 404 且主人的到期提醒仍在；
     * 他人对普通任务 id dismiss 同样 404（204/404 不能成为「该 id 是否为 RECORD」的存在性预言机）。
     */
    @Test
    void othersCannotDismissReminderOfPrivateRecord() {
        ResponseEntity<Map> created = createRecord(Map.of("remindAt",
                java.time.Instant.now().minusSeconds(60).toString()));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        Object recordId = created.getBody().get("id");
        ResponseEntity<Map> task = fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", "普通任务"));
        Object taskId = task.getBody().get("id");
        assertThat(fx.getList(fx.adminTokenA, base + "/records/due").getBody()).hasSize(1);

        String memberToken = fx.addMemberToA();
        assertThat(fx.exchange(memberToken, HttpMethod.POST, base + "/records/" + recordId + "/dismiss", null)
                .getStatusCode().value()).isEqualTo(404);
        assertThat(fx.exchange(memberToken, HttpMethod.POST, base + "/records/" + taskId + "/dismiss", null)
                .getStatusCode().value()).isEqualTo(404);
        // 主人的提醒仍在（未被他人静默关闭）
        ResponseEntity<List> due = fx.getList(fx.adminTokenA, base + "/records/due");
        assertThat(due.getBody()).hasSize(1);
        assertThat(((Map) due.getBody().get(0)).get("id")).isEqualTo(recordId);
        // 主人自己 dismiss 照常 204，之后不再弹
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/records/" + recordId + "/dismiss", null)
                .getStatusCode().value()).isEqualTo(204);
        assertThat(fx.getList(fx.adminTokenA, base + "/records/due").getBody()).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void legacyRecordInSprint_neverShowsInBoardSprintListDashboardRoadmap() {
        ResponseEntity<Map> created = createRecord(Map.of());
        long recordId = ((Number) created.getBody().get("id")).longValue();
        // 模拟历史脏数据：绕过 API 直接把记录挂进迭代与 Epic
        int rows = jdbc.update("UPDATE tasks SET sprint_id = ?, epic_id = ? WHERE id = ?",
                ((Number) sprintId).longValue(), ((Number) epicId).longValue(), recordId);
        assertThat(rows).isEqualTo(1);
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + sprintId + "/start", null).getStatusCode().value()).isEqualTo(200);

        String memberToken = fx.addMemberToA();
        for (String token : List.of(fx.adminTokenA, memberToken)) {
            ResponseEntity<Map> board = fx.exchange(token, HttpMethod.GET,
                    base + "/sprints/" + sprintId + "/board", null);
            Map<String, List<Map>> columns = (Map<String, List<Map>>) board.getBody().get("columns");
            assertThat(columns.values().stream().flatMap(List::stream))
                    .as("看板不应出现记录").noneMatch(t -> "RECORD".equals(t.get("type")));

            ResponseEntity<List> sprints = fx.getList(token, base + "/projects/PM/sprints?withTasks=true");
            Map s = (Map) sprints.getBody().get(0);
            assertThat((List<Map>) s.get("tasks")).as("迭代列表不应出现记录").isEmpty();

            ResponseEntity<Map> dashboard = fx.exchange(token, HttpMethod.GET,
                    base + "/projects/PM/dashboard", null);
            Map<String, Integer> counts = (Map<String, Integer>) dashboard.getBody().get("counts");
            assertThat(counts.values().stream().mapToInt(Integer::intValue).sum())
                    .as("仪表盘计数不应含记录").isZero();

            ResponseEntity<List> roadmap = fx.getList(token, base + "/projects/PM/roadmap");
            Map quarter = (Map) roadmap.getBody().get(0);
            Map epic = (Map) ((List) quarter.get("epics")).get(0);
            assertThat((List<Map>) epic.get("tasks")).as("路线图不应出现记录").isEmpty();
        }
    }
}

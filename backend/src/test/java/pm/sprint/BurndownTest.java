package pm.sprint;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 燃尽图（activities 回放）：
 * 2 周 Sprint，D1 入 3+5pt，D3 完成 3pt（回填 done_at），D5 再拖入 2pt
 * → D1 remaining=8, D3=5, D5=7；ideal 首日 8 线性递减到 0；未来日期不出点。
 */
class BurndownTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;
    @Autowired
    JdbcTemplate jdbc;

    TwoTenantsFixture fx;
    String base;
    LocalDate d1;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo"));
        d1 = pm.common.BizTime.today().minusDays(13); // 2 周 Sprint，今天正好是最后一天 D14
    }

    private long createTaskInSprint(int points, long sprintId) {
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "STORY", "title", points + "pt", "points", points));
        long id = ((Number) t.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id,
                Map.of("sprintId", sprintId));
        return id;
    }

    /** 把某天中午换算成 Instant（与服务端同用业务时区 Asia/Shanghai 做日界）。 */
    private Timestamp noonOf(LocalDate day) {
        Instant instant = day.atTime(12, 0).atZone(pm.common.BizTime.ZONE).toInstant();
        return Timestamp.from(instant);
    }

    /** 回填任务的 created_at 与其 SPRINT_CHANGED activity 的 at 到指定日期。 */
    private void backdateEntry(long taskId, LocalDate day) {
        jdbc.update("UPDATE tasks SET created_at = ? WHERE id = ?", noonOf(day), taskId);
        jdbc.update("UPDATE activities SET at = ? WHERE task_id = ? AND type = 'SPRINT_CHANGED'",
                noonOf(day), taskId);
    }

    @Test
    void burndown_replaysScopeAndDone() {
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints",
                Map.of("length", "WEEK_2", "startDate", d1.toString()));
        long sprintId = ((Number) s.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/sprints/" + sprintId + "/start", null);

        long t3 = createTaskInSprint(3, sprintId);
        long t5 = createTaskInSprint(5, sprintId);
        backdateEntry(t3, d1);
        backdateEntry(t5, d1);

        // D3 完成 3pt：置 DONE 后回填 done_at
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + t3, Map.of("status", "DONE"));
        jdbc.update("UPDATE tasks SET done_at = ? WHERE id = ?", noonOf(d1.plusDays(2)), t3);

        // D5 再拖入 2pt
        long t2 = createTaskInSprint(2, sprintId);
        backdateEntry(t2, d1.plusDays(4));

        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/sprints/" + sprintId + "/burndown", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        List<Map> days = (List<Map>) resp.getBody().get("days");

        // 截至今天（D14）每天一个点，不出未来点
        assertThat(days).hasSize(14);
        assertThat(days.get(0).get("date")).isEqualTo(d1.toString());

        assertThat(((Number) days.get(0).get("remaining")).intValue()).isEqualTo(8);  // D1
        assertThat(((Number) days.get(1).get("remaining")).intValue()).isEqualTo(8);  // D2
        assertThat(((Number) days.get(2).get("remaining")).intValue()).isEqualTo(5);  // D3
        assertThat(((Number) days.get(4).get("remaining")).intValue()).isEqualTo(7);  // D5

        // ideal：首日 scope=8 线性递减，最后一天 0
        assertThat(((Number) days.get(0).get("ideal")).doubleValue()).isEqualTo(8.0);
        assertThat(((Number) days.get(13).get("ideal")).doubleValue()).isEqualTo(0.0);
        double mid = ((Number) days.get(6).get("ideal")).doubleValue();
        assertThat(mid).isBetween(3.9, 4.4); // 8 * (13-6)/13 ≈ 4.31
    }

    @Test
    void burndown_crossTenant_is404() {
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints", Map.of());
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/sprints/" + s.getBody().get("id") + "/burndown", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }
}

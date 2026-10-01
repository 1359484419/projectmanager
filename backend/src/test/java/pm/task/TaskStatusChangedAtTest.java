package pm.task;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * tasks.status_changed_at：创建即等于 created_at；只有状态流转推进它（标题等编辑不动）。
 * 日报「今日完成」按此取数（done_at 只在 DONE 时有值，updated_at 任何编辑都会变）。
 */
class TaskStatusChangedAtTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void statusChangedAt_equalsCreatedAt_onCreate_bumpedOnlyByStatusChange() throws InterruptedException {
        TwoTenantsFixture fx = new TwoTenantsFixture(rest);
        String base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects", Map.of("key", "PM", "name", "demo"));
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "t"));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        Object id = created.getBody().get("id");
        assertThat(created.getBody().get("statusChangedAt")).isNotNull();
        assertThat(created.getBody().get("statusChangedAt")).isEqualTo(created.getBody().get("createdAt"));

        // 详情读回（DB 截断到微秒后）两者仍相等
        ResponseEntity<Map> got0 = fx.exchange(fx.adminTokenA, HttpMethod.GET, base + "/tasks/" + id, null);
        Instant createdAt = Instant.parse((String) got0.getBody().get("createdAt"));
        Instant initial = Instant.parse((String) got0.getBody().get("statusChangedAt"));
        assertThat(initial).isEqualTo(createdAt);

        // PATCH status → 推进
        Thread.sleep(20);
        ResponseEntity<Map> patched = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("status", "IN_PROGRESS"));
        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        assertThat(Instant.parse((String) patched.getBody().get("statusChangedAt"))).isAfter(initial);
        ResponseEntity<Map> got1 = fx.exchange(fx.adminTokenA, HttpMethod.GET, base + "/tasks/" + id, null);
        Instant afterStatus = Instant.parse((String) got1.getBody().get("statusChangedAt"));
        assertThat(afterStatus).isAfter(initial);

        // PATCH 只改 title → 不变（updated_at 变）
        Thread.sleep(20);
        ResponseEntity<Map> titled = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/tasks/" + id, Map.of("title", "t2"));
        assertThat(titled.getStatusCode().value()).isEqualTo(200);
        assertThat(Instant.parse((String) titled.getBody().get("statusChangedAt"))).isEqualTo(afterStatus);
        assertThat(Instant.parse((String) titled.getBody().get("updatedAt"))).isAfter(afterStatus);
        ResponseEntity<Map> got2 = fx.exchange(fx.adminTokenA, HttpMethod.GET, base + "/tasks/" + id, null);
        assertThat(Instant.parse((String) got2.getBody().get("statusChangedAt"))).isEqualTo(afterStatus);

        // 同状态 PATCH（无实际流转）→ 不变
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id, Map.of("status", "IN_PROGRESS"));
        ResponseEntity<Map> got3 = fx.exchange(fx.adminTokenA, HttpMethod.GET, base + "/tasks/" + id, null);
        assertThat(Instant.parse((String) got3.getBody().get("statusChangedAt"))).isEqualTo(afterStatus);
    }

    /**
     * V17 回填：列 NOT NULL；把 V17 里的回填 UPDATE 原样再跑一遍（幂等），
     * 有状态变更 activity 的任务 = 最近一条 STATUS_CHANGED 的 at，没有的 = created_at。
     */
    @Test
    void migration_columnNotNull_andBackfillMatchesActivityOrCreatedAt() throws Exception {
        TwoTenantsFixture fx = new TwoTenantsFixture(rest);
        String base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects", Map.of("key", "PM", "name", "demo"));
        Long plain = ((Number) fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "plain")).getBody().get("id")).longValue();
        Long moved = ((Number) fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "moved")).getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + moved, Map.of("status", "IN_PROGRESS"));
        Thread.sleep(20);
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + moved, Map.of("status", "DONE"));
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + moved, Map.of("title", "moved2"));

        String nullable = jdbc.queryForObject(
                "SELECT is_nullable FROM information_schema.columns "
                        + "WHERE table_name = 'tasks' AND column_name = 'status_changed_at'", String.class);
        assertThat(nullable).isEqualTo("NO");

        // 模拟「存量数据」：先抹成哨兵值，再原样执行 V17 的回填语句
        Timestamp sentinel = Timestamp.from(Instant.parse("2000-01-01T00:00:00Z"));
        jdbc.update("UPDATE tasks SET status_changed_at = ? WHERE id IN (?, ?)", sentinel, plain, moved);
        String sql = new ClassPathResource("db/migration/V17__tasks_status_changed_at.sql")
                .getContentAsString(StandardCharsets.UTF_8);
        String backfill = java.util.Arrays.stream(sql.split(";"))
                .map(String::strip)
                .filter(s -> s.replaceAll("(?m)^--.*$", "").strip().toUpperCase().startsWith("UPDATE TASKS"))
                .findFirst().orElseThrow(() -> new AssertionError("V17 缺少回填 UPDATE"));
        jdbc.execute(backfill);

        Timestamp plainCreated = jdbc.queryForObject("SELECT created_at FROM tasks WHERE id = ?", Timestamp.class, plain);
        Timestamp plainStatus = jdbc.queryForObject("SELECT status_changed_at FROM tasks WHERE id = ?", Timestamp.class, plain);
        assertThat(plainStatus).isEqualTo(plainCreated);

        Timestamp lastChange = jdbc.queryForObject(
                "SELECT max(at) FROM activities WHERE task_id = ? AND type = 'STATUS_CHANGED'", Timestamp.class, moved);
        Timestamp movedStatus = jdbc.queryForObject("SELECT status_changed_at FROM tasks WHERE id = ?", Timestamp.class, moved);
        Timestamp movedCreated = jdbc.queryForObject("SELECT created_at FROM tasks WHERE id = ?", Timestamp.class, moved);
        assertThat(movedStatus).isEqualTo(lastChange);
        assertThat(movedStatus).isAfter(movedCreated);
        assertThat(movedStatus).isNotEqualTo(sentinel);
    }
}

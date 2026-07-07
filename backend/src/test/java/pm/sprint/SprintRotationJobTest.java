package pm.sprint;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;
import pm.task.Activity;
import pm.task.ActivityRepository;
import pm.task.Task;
import pm.task.TaskRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Sprint 自动轮转 job 幂等性三连：
 * 1) 过期 ACTIVE → 关闭 + 新开 + 未完成任务转移（DONE 留守）+ activity；
 * 2) 重复 run() 不重复建 Sprint；
 * 3) 停机 25 天补跑：只留一个 ACTIVE 且 end_date >= today，中间周期为 CLOSED 空 Sprint。
 */
class SprintRotationJobTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;
    @Autowired
    SprintRotationJob job;
    @Autowired
    SprintRepository sprints;
    @Autowired
    TaskRepository tasks;
    @Autowired
    ActivityRepository activities;

    TwoTenantsFixture fx;
    String base;
    Long projectId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PM", "name", "demo"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
        projectId = ((Number) p.getBody().get("id")).longValue();
    }

    /** 建一个已过期的 ACTIVE Sprint（WEEK_2，end = today - daysOverdue）。 */
    private long startExpiredSprint(int daysOverdue) {
        LocalDate start = LocalDate.now().minusDays(13 + daysOverdue);
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/sprints",
                Map.of("length", "WEEK_2", "startDate", start.toString()));
        assertThat(s.getStatusCode().value()).isEqualTo(200);
        long id = ((Number) s.getBody().get("id")).longValue();
        ResponseEntity<Map> started = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + id + "/start", null);
        assertThat(started.getStatusCode().value()).isEqualTo(200);
        return id;
    }

    private long createTaskInSprint(String title, long sprintId, String status) {
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", title, "points", 2));
        long id = ((Number) t.getBody().get("id")).longValue();
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id,
                Map.of("sprintId", sprintId));
        if (!"TODO".equals(status)) {
            fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + id,
                    Map.of("status", status));
        }
        return id;
    }

    @Test
    void run_rotatesExpiredActive_movesUnfinished_keepsDone() {
        long oldSprintId = startExpiredSprint(1); // end = 昨天
        long doneTaskId = createTaskInSprint("已完成", oldSprintId, "DONE");
        long todoTaskId = createTaskInSprint("未完成", oldSprintId, "TODO");

        job.run();

        Sprint old = sprints.findById(oldSprintId).orElseThrow();
        assertThat(old.getStatus()).isEqualTo(Sprint.Status.CLOSED);

        Sprint active = sprints.findByProjectIdAndStatus(projectId, Sprint.Status.ACTIVE).orElseThrow();
        assertThat(active.getId()).isNotEqualTo(oldSprintId);
        assertThat(active.getStartDate()).isEqualTo(old.getEndDate().plusDays(1));

        Task todo = tasks.findById(todoTaskId).orElseThrow();
        assertThat(todo.getSprintId()).isEqualTo(active.getId());
        Task done = tasks.findById(doneTaskId).orElseThrow();
        assertThat(done.getSprintId()).isEqualTo(oldSprintId);

        // 转移写了 SPRINT_CHANGED（系统动作，actor 为空）
        List<Activity> acts = activities.findByTaskIdOrderByAtDescIdDesc(todoTaskId).stream()
                .filter(a -> "SPRINT_CHANGED".equals(a.getType())).toList();
        assertThat(acts).isNotEmpty();
        Activity latest = acts.get(0);
        assertThat(latest.getNewValue()).isEqualTo(String.valueOf(active.getId()));
        assertThat(latest.getActorId()).isNull();
    }

    @Test
    void run_twice_isIdempotent() {
        long oldSprintId = startExpiredSprint(1);
        createTaskInSprint("未完成", oldSprintId, "TODO");

        job.run();
        long countAfterFirst = sprints.countByProjectId(projectId);
        Sprint activeAfterFirst =
                sprints.findByProjectIdAndStatus(projectId, Sprint.Status.ACTIVE).orElseThrow();

        job.run();

        assertThat(sprints.countByProjectId(projectId)).isEqualTo(countAfterFirst);
        Sprint activeAfterSecond =
                sprints.findByProjectIdAndStatus(projectId, Sprint.Status.ACTIVE).orElseThrow();
        assertThat(activeAfterSecond.getId()).isEqualTo(activeAfterFirst.getId());
    }

    @Test
    void run_afterTwentyFiveDaysDowntime_catchesUpToCurrentPeriod() {
        long oldSprintId = startExpiredSprint(25); // end = 25 天前
        long todoTaskId = createTaskInSprint("跨停机未完成", oldSprintId, "TODO");

        job.run();

        List<Sprint> all = sprints.findByProjectIdOrderByIdDesc(projectId);
        List<Sprint> actives = all.stream().filter(s -> s.getStatus() == Sprint.Status.ACTIVE).toList();
        assertThat(actives).hasSize(1);
        Sprint active = actives.get(0);
        LocalDate today = LocalDate.now();
        assertThat(active.getEndDate()).isAfterOrEqualTo(today);
        assertThat(active.getStartDate()).isBeforeOrEqualTo(today);

        // 未完成任务最终落在当前 ACTIVE
        Task todo = tasks.findById(todoTaskId).orElseThrow();
        assertThat(todo.getSprintId()).isEqualTo(active.getId());

        // 中间补跑周期：CLOSED 且为空 Sprint，历史完整（除最早的旧 Sprint 外至少一个）
        List<Sprint> closed = all.stream().filter(s -> s.getStatus() == Sprint.Status.CLOSED).toList();
        assertThat(closed.size()).isGreaterThanOrEqualTo(2); // 旧 Sprint + 至少 1 个补跑周期
        for (Sprint s : closed) {
            if (s.getId() != oldSprintId) {
                assertThat(tasks.findBySprintIdOrderByRankAsc(s.getId())).isEmpty();
            }
        }
        // 周期首尾相接无空洞
        List<Sprint> chrono = all.stream()
                .sorted(java.util.Comparator.comparing(Sprint::getStartDate)).toList();
        for (int i = 1; i < chrono.size(); i++) {
            assertThat(chrono.get(i).getStartDate())
                    .isEqualTo(chrono.get(i - 1).getEndDate().plusDays(1));
        }

        // 补跑到位后再 run 一次仍是 no-op
        job.run();
        assertThat(sprints.countByProjectId(projectId)).isEqualTo(all.size());
    }
}

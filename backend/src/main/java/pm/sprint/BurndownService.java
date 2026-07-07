package pm.sprint;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.task.Activity;
import pm.task.ActivityRepository;
import pm.task.Task;
import pm.task.TaskRepository;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 燃尽图（activities 回放）：
 * 对 Sprint 起止的每一天 d（未来日期不出点）：
 *   scope(d) = 截至 d 已入该 Sprint 且未移出任务的 points 和（随中途加入/移出动态修正）；
 *   done(d)  = 其中 done_at <= d 的 points 和；remaining = scope - done；
 *   ideal    = 首日 scope 线性递减到 0。
 * 任务归属回放：有 SPRINT_CHANGED 记录看截至 d 的最后一条；没有则用初始归属
 * （最早 SPRINT_CHANGED 的 old_value，全程无变更则用当前 sprint_id）+ created_at 门槛。
 */
@Service
public class BurndownService {

    private final SprintService sprintService;
    private final TaskRepository tasks;
    private final ActivityRepository activities;

    public BurndownService(SprintService sprintService, TaskRepository tasks,
                           ActivityRepository activities) {
        this.sprintService = sprintService;
        this.tasks = tasks;
        this.activities = activities;
    }

    public record DayPoint(LocalDate date, BigDecimal remaining, double ideal) {
    }

    public record Burndown(List<DayPoint> days) {
    }

    @Transactional(readOnly = true)
    public Burndown burndown(Long sprintId) {
        Sprint sprint = sprintService.requireById(sprintId);
        String sid = String.valueOf(sprintId);

        // 候选任务：当前在 Sprint 内的 + 历史上进出过的
        Set<Long> taskIds = new HashSet<>();
        List<Task> current = tasks.findBySprintIdOrderByRankAsc(sprintId);
        current.forEach(t -> taskIds.add(t.getId()));
        activities.sprintChangesTouching(sid).forEach(a -> taskIds.add(a.getTaskId()));

        Map<Long, Task> taskById = taskIds.isEmpty() ? Map.of()
                : tasks.findAllById(taskIds).stream()
                        .collect(Collectors.toMap(Task::getId, t -> t));
        Map<Long, List<Activity>> changesByTask = taskIds.isEmpty() ? Map.of()
                : activities.sprintChangesOfTasks(taskIds).stream()
                        .collect(Collectors.groupingBy(Activity::getTaskId));

        LocalDate today = LocalDate.now();
        LocalDate last = sprint.getEndDate().isBefore(today) ? sprint.getEndDate() : today;
        int totalDays = (int) (sprint.getEndDate().toEpochDay() - sprint.getStartDate().toEpochDay()) + 1;

        List<DayPoint> days = new ArrayList<>();
        Map<LocalDate, BigDecimal> scopeByDay = new HashMap<>();
        for (LocalDate d = sprint.getStartDate(); !d.isAfter(last); d = d.plusDays(1)) {
            Instant eod = d.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant();
            BigDecimal scope = BigDecimal.ZERO;
            BigDecimal done = BigDecimal.ZERO;
            for (Long taskId : taskIds) {
                Task task = taskById.get(taskId);
                if (task == null || !inSprintAt(task, changesByTask.get(taskId), sid, eod)) {
                    continue;
                }
                BigDecimal points = task.getPoints() == null ? BigDecimal.ZERO : task.getPoints();
                scope = scope.add(points);
                if (task.getDoneAt() != null && !task.getDoneAt().isAfter(eod)) {
                    done = done.add(points);
                }
            }
            scopeByDay.put(d, scope);
            days.add(new DayPoint(d, scope.subtract(done), 0));
        }

        // ideal：首日 scope 线性递减到最后一天 0
        BigDecimal firstScope = days.isEmpty() ? BigDecimal.ZERO
                : scopeByDay.get(sprint.getStartDate());
        List<DayPoint> withIdeal = new ArrayList<>(days.size());
        for (int i = 0; i < days.size(); i++) {
            DayPoint p = days.get(i);
            double ideal = totalDays <= 1 ? 0
                    : firstScope.doubleValue() * (totalDays - 1 - i) / (totalDays - 1);
            withIdeal.add(new DayPoint(p.date(), p.remaining(), Math.round(ideal * 100) / 100.0));
        }
        return new Burndown(withIdeal);
    }

    /** 截至 eod 时刻任务是否在该 Sprint 内。 */
    private boolean inSprintAt(Task task, List<Activity> changes, String sid, Instant eod) {
        Activity lastBefore = null;
        if (changes != null) {
            for (Activity a : changes) { // 已按 at 升序
                if (a.getAt().isAfter(eod)) {
                    break;
                }
                lastBefore = a;
            }
        }
        if (lastBefore != null) {
            return sid.equals(lastBefore.getNewValue());
        }
        // eod 前无变更：初始归属 + 创建时间门槛
        String initialSprint = (changes == null || changes.isEmpty())
                ? (task.getSprintId() == null ? null : String.valueOf(task.getSprintId()))
                : changes.get(0).getOldValue();
        return Objects.equals(sid, initialSprint) && !task.getCreatedAt().isAfter(eod);
    }
}

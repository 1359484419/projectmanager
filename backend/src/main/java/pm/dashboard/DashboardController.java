package pm.dashboard;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import pm.common.ApiException;
import pm.project.Project;
import pm.project.ProjectRepository;
import pm.sprint.Sprint;
import pm.sprint.SprintRepository;
import pm.task.Task;
import pm.task.TaskBrief;
import pm.task.TaskRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Dashboard：当前 ACTIVE Sprint 的四态概览。无 ACTIVE → {sprint:null}。
 * donePct 按 points（只认 DONE，符合"完成只认 DONE"全局规则）。
 */
@RestController
public class DashboardController {

    private final ProjectRepository projects;
    private final SprintRepository sprints;
    private final TaskRepository tasks;
    private final pm.task.TaskBriefs taskBriefs;

    public DashboardController(ProjectRepository projects, SprintRepository sprints,
                               TaskRepository tasks, pm.task.TaskBriefs taskBriefs) {
        this.projects = projects;
        this.sprints = sprints;
        this.tasks = tasks;
        this.taskBriefs = taskBriefs;
    }

    public record SprintInfo(Long id, String name, LocalDate endDate, long daysLeft) {
    }

    public record Dashboard(SprintInfo sprint, Map<String, Integer> counts, double donePct,
                            Map<String, List<TaskBrief>> groups) {
    }

    @GetMapping("/api/t/{slug}/projects/{key}/dashboard")
    @Transactional(readOnly = true)
    public Dashboard dashboard(@PathVariable String slug, @PathVariable String key) {
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        Sprint active = sprints.findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE)
                .orElse(null);
        if (active == null) {
            return new Dashboard(null, null, 0, null);
        }
        List<Task> sprintTasks = tasks.findBySprintIdOrderByRankAsc(active.getId());

        Map<Task.Status, List<Task>> byStatus = new EnumMap<>(Task.Status.class);
        for (Task.Status s : Task.Status.values()) {
            byStatus.put(s, sprintTasks.stream().filter(t -> t.getStatus() == s).toList());
        }
        var toBriefs = taskBriefs.batch(sprintTasks);
        Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        Map<String, List<TaskBrief>> groups = new java.util.LinkedHashMap<>();
        for (Task.Status s : Task.Status.values()) {
            counts.put(s.name(), byStatus.get(s).size());
            groups.put(s.name(), toBriefs.apply(byStatus.get(s)));
        }

        BigDecimal totalPoints = sprintTasks.stream()
                .map(t -> t.getPoints() == null ? BigDecimal.ZERO : t.getPoints())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal donePoints = byStatus.get(Task.Status.DONE).stream()
                .map(t -> t.getPoints() == null ? BigDecimal.ZERO : t.getPoints())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        double donePct = totalPoints.signum() == 0 ? 0
                : donePoints.multiply(BigDecimal.valueOf(100))
                        .divide(totalPoints, 2, RoundingMode.HALF_UP).doubleValue();

        long daysLeft = Math.max(0,
                ChronoUnit.DAYS.between(pm.common.BizTime.today(), active.getEndDate()));
        SprintInfo info = new SprintInfo(active.getId(), active.getName(), active.getEndDate(), daysLeft);
        return new Dashboard(info, counts, donePct, groups);
    }
}

package pm.epic;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import pm.common.ApiException;
import pm.project.Project;
import pm.project.ProjectRepository;
import pm.task.Task;
import pm.task.TaskBrief;
import pm.task.TaskRepository;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 季度路线图：按 quarter 分组（降序，未指定季度组最后），
 * 每个 Epic 带完成进度（donePoints 只认 DONE 任务）与任务摘要列表。
 */
@RestController
public class RoadmapController {

    private final EpicRepository epics;
    private final TaskRepository tasks;
    private final ProjectRepository projects;

    public RoadmapController(EpicRepository epics, TaskRepository tasks, ProjectRepository projects) {
        this.epics = epics;
        this.tasks = tasks;
        this.projects = projects;
    }

    public record EpicProgress(Long id, String name, String color, Epic.Status status,
                               BigDecimal donePoints, BigDecimal totalPoints, List<TaskBrief> tasks) {
    }

    public record QuarterGroup(String quarter, List<EpicProgress> epics) {
    }

    @GetMapping("/api/t/{slug}/projects/{key}/roadmap")
    public List<QuarterGroup> roadmap(@PathVariable String slug, @PathVariable String key) {
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        List<Epic> allEpics = epics.findByProjectIdOrderByIdAsc(project.getId());
        Map<Long, List<Task>> tasksByEpic = allEpics.isEmpty() ? Map.of()
                : tasks.findByEpicIdInOrderByRankAsc(allEpics.stream().map(Epic::getId).toList())
                        .stream().collect(Collectors.groupingBy(Task::getEpicId));

        Map<String, List<EpicProgress>> byQuarter = allEpics.stream().collect(Collectors.groupingBy(
                e -> e.getQuarter() == null ? "" : e.getQuarter(),
                Collectors.mapping(e -> toProgress(e, tasksByEpic.getOrDefault(e.getId(), List.of())),
                        Collectors.toList())));

        return byQuarter.entrySet().stream()
                // quarter 降序；"" (未指定季度) 排最后
                .sorted(Comparator.comparing((Map.Entry<String, List<EpicProgress>> en) -> en.getKey().isEmpty())
                        .thenComparing(Map.Entry::getKey, Comparator.reverseOrder()))
                .map(en -> new QuarterGroup(en.getKey().isEmpty() ? null : en.getKey(), en.getValue()))
                .toList();
    }

    private EpicProgress toProgress(Epic epic, List<Task> epicTasks) {
        BigDecimal total = epicTasks.stream()
                .map(t -> t.getPoints() == null ? BigDecimal.ZERO : t.getPoints())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal done = epicTasks.stream().filter(t -> t.getStatus() == Task.Status.DONE)
                .map(t -> t.getPoints() == null ? BigDecimal.ZERO : t.getPoints())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new EpicProgress(epic.getId(), epic.getName(), epic.getColor(), epic.getStatus(),
                done, total, epicTasks.stream().map(TaskBrief::from).toList());
    }
}

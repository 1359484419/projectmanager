package pm.sprint;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.project.Project;
import pm.task.TaskBrief;
import pm.task.TaskRepository;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class SprintController {

    private final SprintService sprintService;
    private final CapacityService capacityService;
    private final BurndownService burndownService;
    private final TaskRepository tasks;
    private final pm.task.TaskBriefs taskBriefs;

    public SprintController(SprintService sprintService, CapacityService capacityService,
                            BurndownService burndownService, TaskRepository tasks,
                            pm.task.TaskBriefs taskBriefs) {
        this.sprintService = sprintService;
        this.capacityService = capacityService;
        this.burndownService = burndownService;
        this.tasks = tasks;
        this.taskBriefs = taskBriefs;
    }

    public record SprintWithTasks(Long id, Long projectId, String name, Project.SprintLength length,
                                  LocalDate startDate, LocalDate endDate, Sprint.Status status,
                                  List<TaskBrief> tasks) {
    }

    public record CapacityPut(int capacity) {
    }

    /** Board 页四列数据：{sprint, daysLeft, columns:{TODO:[TaskBrief],...}}。 */
    public record BoardView(SprintService.SprintView sprint, long daysLeft,
                            Map<String, List<TaskBrief>> columns) {
    }

    @PostMapping("/api/t/{slug}/projects/{key}/sprints")
    SprintService.SprintView create(@PathVariable String slug, @PathVariable String key,
                                    @RequestBody(required = false) SprintService.CreateSprintRequest req) {
        return sprintService.create(key, req);
    }

    @PostMapping("/api/t/{slug}/sprints/{id}/start")
    SprintService.SprintView start(@PathVariable String slug, @PathVariable Long id) {
        return sprintService.start(id);
    }

    @PostMapping("/api/t/{slug}/sprints/{id}/close")
    SprintService.SprintView close(@PathVariable String slug, @PathVariable Long id,
                                   @RequestBody(required = false) SprintService.CloseSprintRequest req) {
        return sprintService.close(id, req, CurrentUser.id());
    }

    /** All Sprints：倒序列表，withTasks=true 时每个 Sprint 附任务摘要。 */
    @GetMapping("/api/t/{slug}/projects/{key}/sprints")
    List<SprintWithTasks> list(@PathVariable String slug, @PathVariable String key,
                               @RequestParam(defaultValue = "false") boolean withTasks) {
        return sprintService.listByProject(key).stream()
                .map(s -> new SprintWithTasks(s.getId(), s.getProjectId(), s.getName(),
                        s.getLength(), s.getStartDate(), s.getEndDate(), s.getStatus(),
                        withTasks
                                ? taskBriefs.of(tasks.findBySprintIdOrderByRankAsc(s.getId()))
                                : null))
                .toList();
    }

    /** 看板：Sprint 内任务按四态分列（每列按 rank 排序）。 */
    @GetMapping("/api/t/{slug}/sprints/{id}/board")
    @Transactional(readOnly = true)
    BoardView board(@PathVariable String slug, @PathVariable Long id) {
        Sprint sprint = sprintService.requireById(id);
        List<pm.task.Task> sprintTasks = tasks.findBySprintIdOrderByRankAsc(sprint.getId());
        var toBriefs = taskBriefs.batch(sprintTasks);
        Map<String, List<TaskBrief>> columns = new LinkedHashMap<>();
        for (pm.task.Task.Status s : pm.task.Task.Status.values()) {
            columns.put(s.name(), toBriefs.apply(sprintTasks.stream()
                    .filter(t -> t.getStatus() == s).toList()));
        }
        long daysLeft = Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(
                pm.common.BizTime.today(), sprint.getEndDate()));
        return new BoardView(SprintService.SprintView.from(sprint), daysLeft, columns);
    }

    @GetMapping("/api/t/{slug}/sprints/{id}/burndown")
    BurndownService.Burndown burndown(@PathVariable String slug, @PathVariable Long id) {
        return burndownService.burndown(id);
    }

    @GetMapping("/api/t/{slug}/sprints/{id}/capacity")
    List<CapacityService.CapacityRow> capacity(@PathVariable String slug, @PathVariable Long id) {
        return capacityService.capacity(id);
    }

    @PutMapping("/api/t/{slug}/sprints/{id}/capacity/{userId}")
    CapacityService.CapacityRow putCapacity(@PathVariable String slug, @PathVariable Long id,
                                            @PathVariable Long userId, @RequestBody CapacityPut req) {
        return capacityService.upsertOverride(id, userId, req.capacity());
    }
}

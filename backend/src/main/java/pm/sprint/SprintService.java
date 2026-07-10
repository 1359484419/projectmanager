package pm.sprint;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.ApiException;
import pm.project.Project;
import pm.project.ProjectRepository;
import pm.task.Activity;
import pm.task.Task;
import pm.task.TaskRepository;
import pm.task.TaskService;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * Sprint 生命周期：创建（默认项目周期/顺序命名）、启动（ACTIVE 唯一）、
 * 关闭（未完成任务退回 Backlog 或移入指定 Sprint）、rotate（供自动轮转 job 复用）。
 */
@Service
public class SprintService {

    private final SprintRepository sprints;
    private final ProjectRepository projects;
    private final TaskRepository tasks;
    private final TaskService taskService;

    public SprintService(SprintRepository sprints, ProjectRepository projects,
                         TaskRepository tasks, TaskService taskService) {
        this.sprints = sprints;
        this.projects = projects;
        this.tasks = tasks;
        this.taskService = taskService;
    }

    public record SprintView(Long id, Long projectId, String name, Project.SprintLength length,
                             LocalDate startDate, LocalDate endDate, Sprint.Status status) {
        public static SprintView from(Sprint s) {
            return new SprintView(s.getId(), s.getProjectId(), s.getName(), s.getLength(),
                    s.getStartDate(), s.getEndDate(), s.getStatus());
        }
    }

    public record CreateSprintRequest(String name, Project.SprintLength length, LocalDate startDate) {
    }

    public enum UnfinishedOption { BACKLOG, MOVE }

    public record CloseSprintRequest(UnfinishedOption unfinished, Long targetSprintId) {
    }

    // ---------- 命令 ----------

    @Transactional
    public SprintView create(String projectKey, CreateSprintRequest req) {
        // 锁项目行串行分配 Sprint 序号命名
        Project project = projects.findByKeyForUpdate(projectKey).orElseThrow(ApiException::notFound);
        Sprint sprint = newSprint(project,
                req == null ? null : req.name(),
                req == null || req.length() == null ? project.getDefaultSprintLength() : req.length(),
                req == null || req.startDate() == null ? pm.common.BizTime.today() : req.startDate());
        return SprintView.from(sprint);
    }

    @Transactional
    public SprintView start(Long sprintId) {
        Sprint sprint = requireById(sprintId);
        if (sprint.getStatus() != Sprint.Status.PLANNED) {
            throw ApiException.conflict("SPRINT_NOT_PLANNED", "only a PLANNED sprint can be started");
        }
        sprints.findByProjectIdAndStatus(sprint.getProjectId(), Sprint.Status.ACTIVE)
                .ifPresent(active -> {
                    throw ApiException.conflict("ACTIVE_SPRINT_EXISTS",
                            "project already has an active sprint: " + active.getName());
                });
        sprint.setStatus(Sprint.Status.ACTIVE);
        sprints.save(sprint); // MyBatis 无 JPA 脏检查，显式落库
        return SprintView.from(sprint);
    }

    @Transactional
    public SprintView close(Long sprintId, CloseSprintRequest req, Long actor) {
        Sprint sprint = requireById(sprintId);
        if (sprint.getStatus() != Sprint.Status.ACTIVE) {
            throw ApiException.conflict("SPRINT_NOT_ACTIVE", "only an ACTIVE sprint can be closed");
        }
        UnfinishedOption option = req == null || req.unfinished() == null
                ? UnfinishedOption.BACKLOG : req.unfinished();
        Long target = null;
        if (option == UnfinishedOption.MOVE) {
            if (req.targetSprintId() == null) {
                throw ApiException.badRequest("VALIDATION", "targetSprintId is required for MOVE");
            }
            Sprint targetSprint = requireById(req.targetSprintId());
            if (targetSprint.getId().equals(sprint.getId())) {
                throw ApiException.badRequest("VALIDATION", "target sprint must differ from the closing one");
            }
            target = targetSprint.getId();
        }
        moveUnfinished(sprint, target, actor);
        sprint.setStatus(Sprint.Status.CLOSED);
        sprints.save(sprint); // MyBatis 无 JPA 脏检查，显式落库
        return SprintView.from(sprint);
    }

    /**
     * 自动轮转（供每日 job 调用）：ACTIVE 已过期（end_date < today）则
     * 关闭 → 建新 Sprint（start = 旧 end + 1，按项目默认周期）→ 未完成任务移入 → 启动。
     * 返回新 Sprint；无过期 ACTIVE 返回 empty（幂等）。
     */
    @Transactional
    public Optional<Sprint> rotate(Project project, LocalDate today) {
        Optional<Sprint> activeOpt =
                sprints.findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE);
        if (activeOpt.isEmpty() || !activeOpt.get().getEndDate().isBefore(today)) {
            return Optional.empty();
        }
        Sprint old = activeOpt.get();
        old.setStatus(Sprint.Status.CLOSED);
        // 先落 CLOSED 再插新 ACTIVE，避免 one_active_sprint 部分唯一索引冲突
        // （原 sprints.flush()；MyBatis 语句即时执行，save 即落库）
        sprints.save(old);
        Sprint next = newSprint(project, null, project.getDefaultSprintLength(),
                old.getEndDate().plusDays(1));
        next.setStatus(Sprint.Status.ACTIVE);
        sprints.save(next); // newSprint 插入时是 PLANNED，置 ACTIVE 后显式落库（MyBatis 无脏检查）
        for (Task task : tasks.findBySprintIdOrderByRankAsc(old.getId())) {
            if (task.getStatus() != Task.Status.DONE) {
                taskService.changeSprint(task, next.getId(), null, Activity.Source.WEB);
            }
        }
        return Optional.of(next);
    }

    // ---------- 查询 ----------

    public Sprint requireById(Long sprintId) {
        return sprints.findOneById(sprintId).orElseThrow(ApiException::notFound);
    }

    @Transactional(readOnly = true)
    public List<Sprint> listByProject(String projectKey) {
        Project project = projects.findByKey(projectKey).orElseThrow(ApiException::notFound);
        return sprints.findByProjectIdOrderByIdDesc(project.getId());
    }

    // ---------- 内部 ----------

    private Sprint newSprint(Project project, String name, Project.SprintLength length, LocalDate start) {
        String finalName = (name == null || name.isBlank())
                ? "Sprint " + (sprints.countByProjectId(project.getId()) + 1)
                : name;
        Sprint sprint = new Sprint(project.getId(), finalName, length, start, endDateOf(start, length));
        return sprints.save(sprint);
    }

    static LocalDate endDateOf(LocalDate start, Project.SprintLength length) {
        return switch (length) {
            case WEEK_1 -> start.plusDays(6);
            case WEEK_2 -> start.plusDays(13);
            case MONTH_1 -> start.plusMonths(1).minusDays(1);
        };
    }

    private void moveUnfinished(Sprint sprint, Long targetSprintId, Long actor) {
        for (Task task : tasks.findBySprintIdOrderByRankAsc(sprint.getId())) {
            if (task.getStatus() != Task.Status.DONE) {
                taskService.changeSprint(task, targetSprintId, actor, Activity.Source.WEB);
            }
        }
    }
}

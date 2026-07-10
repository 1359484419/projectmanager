package pm.task;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.ApiException;
import pm.project.Project;
import pm.project.ProjectRepository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

@Service
public class TaskService {

    private final TaskRepository tasks;
    private final ProjectRepository projects;
    private final ActivityRepository activityRepo;
    private final pm.comment.CommentRepository commentRepo;
    private final ActivityRecorder recorder;
    private final RankService rankService;
    private final pm.sprint.SprintRepository sprints;
    private final pm.epic.EpicRepository epics;
    private final pm.tenantadmin.MembershipRepository memberships;

    public TaskService(TaskRepository tasks, ProjectRepository projects,
                       ActivityRepository activityRepo, pm.comment.CommentRepository commentRepo,
                       ActivityRecorder recorder,
                       RankService rankService, pm.sprint.SprintRepository sprints,
                       pm.epic.EpicRepository epics, pm.tenantadmin.MembershipRepository memberships) {
        this.tasks = tasks;
        this.projects = projects;
        this.activityRepo = activityRepo;
        this.commentRepo = commentRepo;
        this.recorder = recorder;
        this.rankService = rankService;
        this.sprints = sprints;
        this.epics = epics;
        this.memberships = memberships;
    }

    // ---------- 视图 ----------

    public record TaskView(Long id, Long projectId, int seq, String displayKey, Task.Type type,
                           String title, String description, BigDecimal points, Long epicId,
                           Long sprintId, Long assigneeId, Task.Status status, String rank,
                           Instant createdAt, Instant doneAt, Long createdBy) {
        public static TaskView from(Task t, String projectKey) {
            return new TaskView(t.getId(), t.getProjectId(), t.getSeq(),
                    projectKey + "-" + t.getSeq(), t.getType(), t.getTitle(), t.getDescription(),
                    t.getPoints(), t.getEpicId(), t.getSprintId(), t.getAssigneeId(),
                    t.getStatus(), t.getRank(), t.getCreatedAt(), t.getDoneAt(), t.getCreatedBy());
        }
    }

    public record ActivityView(Long id, String type, String oldValue, String newValue,
                               Long actorId, Activity.Source source, Instant at) {
        static ActivityView from(Activity a) {
            return new ActivityView(a.getId(), a.getType(), a.getOldValue(), a.getNewValue(),
                    a.getActorId(), a.getSource(), a.getAt());
        }
    }

    public record RankMove(Long afterTaskId, Long beforeTaskId) {
    }

    public record CreateTaskRequest(Task.Type type, String title, String description,
                                    BigDecimal points, Long epicId, Long sprintId, Long assigneeId) {
    }

    /**
     * assigneeId/epicId/sprintId 用 {@link pm.common.PatchLong} 区分「字段未传」（组件为 null，不改）
     * 与「显式传 null」（PatchLong(null)，置空——移回 Backlog / 取消指派 / 摘除 Epic）。
     */
    public record UpdateTaskRequest(Task.Status status, BigDecimal points,
                                    pm.common.PatchLong assigneeId,
                                    pm.common.PatchLong epicId,
                                    pm.common.PatchLong sprintId,
                                    String title, String description,
                                    RankMove rank) {
    }

    // ---------- 命令 ----------

    /** 建任务：seq 项目内自增（锁项目行串行分配），rank 尾插，默认 TODO。 */
    @Transactional
    public TaskView create(String projectKey, CreateTaskRequest req, Long actor, Activity.Source source) {
        if (req.type() == null) {
            throw ApiException.badRequest("VALIDATION", "type is required");
        }
        if (req.title() == null || req.title().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "title is required");
        }
        pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.TASK_TITLE, "任务标题");
        pm.common.FieldLimits.check(req.description(), pm.common.FieldLimits.TASK_DESCRIPTION, "任务描述");
        validatePoints(req.points());
        Project project = projects.findByKeyForUpdate(projectKey).orElseThrow(ApiException::notFound);
        validateEpicRef(req.epicId(), project.getId());
        validateSprintRef(req.sprintId(), project.getId());
        validateAssigneeRef(req.assigneeId());
        int seq = tasks.maxSeq(project.getId()) + 1;
        String rank = rankService.between(tasks.maxRank(project.getId()).orElse(null), null);
        Task task = new Task(project.getId(), req.type(), seq, req.title(), rank);
        task.setDescription(req.description());
        task.setPoints(req.points());
        task.setEpicId(req.epicId());
        task.setSprintId(req.sprintId());
        task.setAssigneeId(req.assigneeId());
        task.setCreatedBy(actor);
        tasks.save(task);
        recorder.record(task, actor, "CREATED", null, project.getKey() + "-" + seq, source);
        return TaskView.from(task, project.getKey());
    }

    /** 状态流转：进 DONE 写 done_at，离开清空；写 STATUS_CHANGED。 */
    @Transactional
    public void changeStatus(Task task, Task.Status newStatus, Long actor, Activity.Source source) {
        Task.Status old = task.getStatus();
        if (old == newStatus) {
            return;
        }
        task.setStatus(newStatus);
        if (newStatus == Task.Status.DONE) {
            task.setDoneAt(Instant.now());
        } else if (old == Task.Status.DONE) {
            task.setDoneAt(null);
        }
        recorder.record(task, actor, "STATUS_CHANGED", old.name(), newStatus.name(), source);
    }

    /** 通用 PATCH：每个可变字段变更都留 activity。 */
    @Transactional
    public TaskView update(Long taskId, UpdateTaskRequest req, Long actor, Activity.Source source) {
        Task task = requireById(taskId);
        if (req.status() != null) {
            changeStatus(task, req.status(), actor, source);
        }
        if (req.points() != null) {
            validatePoints(req.points());
            if (task.getPoints() == null || task.getPoints().compareTo(req.points()) != 0) {
                recorder.record(task, actor, "POINTS_CHANGED",
                        toStr(task.getPoints()), toStr(req.points()), source);
                task.setPoints(req.points());
            }
        }
        if (req.assigneeId() != null) {
            Long v = req.assigneeId().value();
            validateAssigneeRef(v);
            if (!Objects.equals(task.getAssigneeId(), v)) {
                recorder.record(task, actor, "ASSIGNED",
                        toStr(task.getAssigneeId()), toStr(v), source);
                task.setAssigneeId(v);
            }
        }
        if (req.epicId() != null) {
            Long v = req.epicId().value();
            validateEpicRef(v, task.getProjectId());
            if (!Objects.equals(task.getEpicId(), v)) {
                recorder.record(task, actor, "EPIC_CHANGED",
                        toStr(task.getEpicId()), toStr(v), source);
                task.setEpicId(v);
            }
        }
        if (req.sprintId() != null) {
            changeSprint(task, req.sprintId().value(), actor, source);
        }
        if (req.title() != null && !req.title().equals(task.getTitle())) {
            if (req.title().isBlank()) {
                throw ApiException.badRequest("VALIDATION", "title must not be blank");
            }
            pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.TASK_TITLE, "任务标题");
            recorder.record(task, actor, "TITLE_CHANGED", task.getTitle(), req.title(), source);
            task.setTitle(req.title());
        }
        if (req.description() != null && !req.description().equals(task.getDescription())) {
            pm.common.FieldLimits.check(req.description(),
                    pm.common.FieldLimits.TASK_DESCRIPTION, "任务描述");
            recorder.record(task, actor, "DESCRIPTION_CHANGED",
                    task.getDescription(), req.description(), source);
            task.setDescription(req.description());
        }
        if (req.rank() != null) {
            task.setRank(computeRank(req.rank()));
        }
        return toView(task);
    }

    /** 删除任务：仅创建者或租户 ADMIN 可删；同时清除关联的 activity 和评论。 */
    @Transactional
    public void delete(Long taskId, Long actor) {
        Task task = requireById(taskId);
        boolean isCreator = task.getCreatedBy() != null && actor.equals(task.getCreatedBy());
        boolean isAdmin = pm.tenant.TenantContext.requireRole() == pm.tenantadmin.Membership.Role.ADMIN;
        if (!isCreator && !isAdmin) {
            throw ApiException.forbidden("FORBIDDEN", "只有任务创建者或管理员可以删除任务");
        }
        activityRepo.deleteByTaskId(taskId);
        commentRepo.deleteByTaskId(taskId);
        tasks.delete(task);
    }

    /** Sprint 归属变更（含移回 Backlog：sprintId=null），写 SPRINT_CHANGED。 */
    @Transactional
    public void changeSprint(Task task, Long newSprintId, Long actor, Activity.Source source) {
        if (Objects.equals(task.getSprintId(), newSprintId)) {
            return;
        }
        validateSprintRef(newSprintId, task.getProjectId());
        recorder.record(task, actor, "SPRINT_CHANGED",
                toStr(task.getSprintId()), toStr(newSprintId), source);
        task.setSprintId(newSprintId);
    }

    // ---------- 查询 ----------

    @Transactional(readOnly = true)
    public List<TaskView> backlog(String projectKey) {
        Project project = projects.findByKey(projectKey).orElseThrow(ApiException::notFound);
        return tasks.findByProjectIdAndSprintIdIsNullOrderByRankAsc(project.getId()).stream()
                .map(t -> TaskView.from(t, project.getKey()))
                .toList();
    }

    /** 搜索命中：带 displayKey 与所属项目 key（前端跳转/开抽屉用）。 */
    public record SearchHit(Long id, int seq, String displayKey, String projectKey, String title,
                            Task.Type type, Task.Status status, BigDecimal points,
                            Long assigneeId, String description) {
    }

    /** 全租户关键词搜索（标题/描述），跨项目跨负责人，最多 20 条，按新→旧。 */
    @Transactional(readOnly = true)
    public List<SearchHit> search(String q) {
        if (q == null || q.strip().length() < 1) {
            return List.of();
        }
        var keyById = new java.util.HashMap<Long, String>();
        projects.findAllByOrderByIdAsc().forEach(p -> keyById.put(p.getId(), p.getKey()));
        return tasks.search(q.strip(), org.springframework.data.domain.PageRequest.of(0, 20)).stream()
                .map(t -> {
                    String key = keyById.getOrDefault(t.getProjectId(), "?");
                    return new SearchHit(t.getId(), t.getSeq(), key + "-" + t.getSeq(), key,
                            t.getTitle(), t.getType(), t.getStatus(), t.getPoints(),
                            t.getAssigneeId(), TaskBrief.snippet(t.getDescription()));
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ActivityView> activities(Long taskId) {
        requireById(taskId);
        return activityRepo.findByTaskIdOrderByAtDescIdDesc(taskId).stream()
                .map(ActivityView::from)
                .toList();
    }

    public Task requireById(Long taskId) {
        return tasks.findOneById(taskId).orElseThrow(ApiException::notFound);
    }

    public TaskView toView(Task task) {
        Project project = projects.findOneById(task.getProjectId()).orElseThrow(ApiException::notFound);
        return TaskView.from(task, project.getKey());
    }

    // ---------- 内部 ----------

    private String computeRank(RankMove move) {
        String after = move.afterTaskId() == null ? null : requireById(move.afterTaskId()).getRank();
        String before = move.beforeTaskId() == null ? null : requireById(move.beforeTaskId()).getRank();
        try {
            return rankService.between(after, before);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("INVALID_RANK_MOVE", e.getMessage());
        }
    }

    /**
     * 跨实体引用归属校验（REST 与 MCP 共用；置空 null 直接放行）：
     * sprint/epic 必须属于任务所在项目（跨租户经 tenantFilter 查不到，同样 400），
     * assignee 必须是当前租户成员。防同租户跨项目污染看板/路线图与跨租户悬挂引用。
     */
    private void validateSprintRef(Long sprintId, Long projectId) {
        if (sprintId == null) {
            return;
        }
        boolean ok = sprints.findOneById(sprintId)
                .map(s -> s.getProjectId().equals(projectId))
                .orElse(false);
        if (!ok) {
            throw ApiException.badRequest("INVALID_SPRINT", "sprint 不存在或不属于该项目");
        }
    }

    private void validateEpicRef(Long epicId, Long projectId) {
        if (epicId == null) {
            return;
        }
        if (epics.findByIdAndProjectId(epicId, projectId).isEmpty()) {
            throw ApiException.badRequest("INVALID_EPIC", "epic 不存在或不属于该项目");
        }
    }

    private void validateAssigneeRef(Long assigneeId) {
        if (assigneeId == null) {
            return;
        }
        if (memberships.findByUserIdAndTenantId(assigneeId, pm.tenant.TenantContext.require()).isEmpty()) {
            throw ApiException.badRequest("INVALID_ASSIGNEE", "assignee 不是本租户成员");
        }
    }

    private static final BigDecimal MIN_POINTS = new BigDecimal("0.5");
    private static final BigDecimal MAX_POINTS = new BigDecimal("5");

    /** points 非空时必须 0.5 ≤ p ≤ 5 且为 0.5 的倍数。文案中文，REST 前端与 MCP agent 共用。 */
    private void validatePoints(BigDecimal points) {
        if (points == null) {
            return;
        }
        boolean inRange = points.compareTo(MIN_POINTS) >= 0 && points.compareTo(MAX_POINTS) <= 0;
        // 0.5 的倍数 ⇔ points*2 为整数
        boolean halfStep = points.multiply(BigDecimal.valueOf(2)).stripTrailingZeros().scale() <= 0;
        if (!inRange || !halfStep) {
            throw ApiException.badRequest("INVALID_POINTS",
                    "points 必须在 0.5 到 5 之间，且为 0.5 的倍数（如 0.5、1、1.5、2 … 5）");
        }
    }

    private static String toStr(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}

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
    private final ActivityRecorder recorder;
    private final RankService rankService;

    public TaskService(TaskRepository tasks, ProjectRepository projects,
                       ActivityRepository activityRepo, ActivityRecorder recorder,
                       RankService rankService) {
        this.tasks = tasks;
        this.projects = projects;
        this.activityRepo = activityRepo;
        this.recorder = recorder;
        this.rankService = rankService;
    }

    // ---------- 视图 ----------

    public record TaskView(Long id, Long projectId, int seq, String displayKey, Task.Type type,
                           String title, String description, BigDecimal points, Long epicId,
                           Long sprintId, Long assigneeId, Task.Status status, String rank,
                           Instant createdAt, Instant doneAt) {
        public static TaskView from(Task t, String projectKey) {
            return new TaskView(t.getId(), t.getProjectId(), t.getSeq(),
                    projectKey + "-" + t.getSeq(), t.getType(), t.getTitle(), t.getDescription(),
                    t.getPoints(), t.getEpicId(), t.getSprintId(), t.getAssigneeId(),
                    t.getStatus(), t.getRank(), t.getCreatedAt(), t.getDoneAt());
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

    public record UpdateTaskRequest(Task.Status status, BigDecimal points, Long assigneeId,
                                    Long epicId, Long sprintId, String title, String description,
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
        validatePoints(req.points());
        Project project = projects.findByKeyForUpdate(projectKey).orElseThrow(ApiException::notFound);
        int seq = tasks.maxSeq(project.getId()) + 1;
        String rank = rankService.between(tasks.maxRank(project.getId()).orElse(null), null);
        Task task = new Task(project.getId(), req.type(), seq, req.title(), rank);
        task.setDescription(req.description());
        task.setPoints(req.points());
        task.setEpicId(req.epicId());
        task.setSprintId(req.sprintId());
        task.setAssigneeId(req.assigneeId());
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
        if (req.assigneeId() != null && !Objects.equals(task.getAssigneeId(), req.assigneeId())) {
            recorder.record(task, actor, "ASSIGNED",
                    toStr(task.getAssigneeId()), toStr(req.assigneeId()), source);
            task.setAssigneeId(req.assigneeId());
        }
        if (req.epicId() != null && !Objects.equals(task.getEpicId(), req.epicId())) {
            recorder.record(task, actor, "EPIC_CHANGED",
                    toStr(task.getEpicId()), toStr(req.epicId()), source);
            task.setEpicId(req.epicId());
        }
        if (req.sprintId() != null && !Objects.equals(task.getSprintId(), req.sprintId())) {
            changeSprint(task, req.sprintId(), actor, source);
        }
        if (req.title() != null && !req.title().equals(task.getTitle())) {
            if (req.title().isBlank()) {
                throw ApiException.badRequest("VALIDATION", "title must not be blank");
            }
            recorder.record(task, actor, "TITLE_CHANGED", task.getTitle(), req.title(), source);
            task.setTitle(req.title());
        }
        if (req.description() != null && !req.description().equals(task.getDescription())) {
            recorder.record(task, actor, "DESCRIPTION_CHANGED",
                    task.getDescription(), req.description(), source);
            task.setDescription(req.description());
        }
        if (req.rank() != null) {
            task.setRank(computeRank(req.rank()));
        }
        return toView(task);
    }

    /** Sprint 归属变更（含移回 Backlog：sprintId=null），写 SPRINT_CHANGED。 */
    @Transactional
    public void changeSprint(Task task, Long newSprintId, Long actor, Activity.Source source) {
        if (Objects.equals(task.getSprintId(), newSprintId)) {
            return;
        }
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

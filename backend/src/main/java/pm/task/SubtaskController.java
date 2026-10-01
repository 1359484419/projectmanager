package pm.task;

import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.common.PatchLong;
import pm.common.PatchString;
import pm.common.RequestSource;
import pm.tenant.TenantContext;
import pm.tenantadmin.MembershipRepository;
import pm.user.UserRepository;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Objects;

/**
 * 子任务 REST（与评论一致：租户成员即可操作，无创建者限制）。
 * 子任务只挂在主任务下，四个端点都经 TaskService.requireById 校验主任务归属（跨租户 404；
 * 主任务是他人的私有记录 RECORD 也 404）。按 id 直达的 PATCH/DELETE 同样要过这一关：
 * 子任务 id 全局自增可枚举，否则会成为读改删私有记录子任务的旁路（审查 2026-09-25 #1）。
 *
 * 写操作统一三件事：留 SUBTASK_* activity（挂在主任务时间线上）、推进主任务 updated_at（日报取数）。
 */
@RestController
public class SubtaskController {

    private final SubtaskRepository subtasks;
    private final TaskService taskService;
    private final TaskRepository taskRepo;
    private final ActivityRecorder recorder;
    private final RankService rankService;
    private final MembershipRepository memberships;
    private final UserRepository users;

    public SubtaskController(SubtaskRepository subtasks, TaskService taskService,
                             TaskRepository taskRepo, ActivityRecorder recorder,
                             RankService rankService, MembershipRepository memberships,
                             UserRepository users) {
        this.subtasks = subtasks;
        this.taskService = taskService;
        this.taskRepo = taskRepo;
        this.recorder = recorder;
        this.rankService = rankService;
        this.memberships = memberships;
        this.users = users;
    }

    public record CreateSubtaskRequest(String title) {
    }

    /** 拖拽排序锚点：afterId/beforeId 为相邻子任务 id，null 表示该方向无邻居（头插/尾插）。 */
    public record SubtaskRankMove(Long afterId, Long beforeId) {
    }

    /**
     * description/assigneeId/dueDate 为 PATCH 三态：字段缺省不改；显式 null 置空；传值更新。
     * dueDate 字符串格式 yyyy-MM-dd。
     */
    public record UpdateSubtaskRequest(Boolean done, String title, SubtaskRankMove rank,
                                       PatchString description, PatchLong assigneeId,
                                       PatchString dueDate) {
    }

    public record SubtaskView(Long id, Long taskId, String title, boolean done,
                              Instant doneAt, Long doneBy, String description, Long assigneeId,
                              LocalDate dueDate, Instant createdAt) {
        static SubtaskView from(Subtask s) {
            return new SubtaskView(s.getId(), s.getTaskId(), s.getTitle(), s.isDone(),
                    s.getDoneAt(), s.getDoneBy(), s.getDescription(), s.getAssigneeId(),
                    s.getDueDate(), s.getCreatedAt());
        }
    }

    @GetMapping("/api/t/{slug}/tasks/{taskId}/subtasks")
    @Transactional(readOnly = true)
    public List<SubtaskView> list(@PathVariable String slug, @PathVariable Long taskId) {
        taskService.requireById(taskId); // 归属校验（跨租户 404）
        return subtasks.findByTaskIdOrderByRankAsc(taskId).stream()
                .map(SubtaskView::from)
                .toList();
    }

    /** 创建：rank 尾插（与任务进 backlog 同一算法）。 */
    @PostMapping("/api/t/{slug}/tasks/{taskId}/subtasks")
    @Transactional
    public SubtaskView create(@PathVariable String slug, @PathVariable Long taskId,
                              @RequestBody CreateSubtaskRequest req) {
        if (req == null || req.title() == null || req.title().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "title is required");
        }
        pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.SUBTASK_TITLE, "子任务标题");
        Task task = taskService.requireById(taskId); // 归属校验（跨租户 404）
        Subtask subtask = new Subtask(taskId, req.title());
        subtask.setRank(rankService.between(subtasks.maxRank(taskId).orElse(null), null));
        subtasks.save(subtask);
        recorder.record(task, CurrentUser.id(), "SUBTASK_CREATED", null, req.title(),
                RequestSource.current());
        taskRepo.touchUpdatedAt(taskId);
        return SubtaskView.from(subtask);
    }

    @PatchMapping("/api/t/{slug}/subtasks/{id}")
    @Transactional
    public SubtaskView update(@PathVariable String slug, @PathVariable Long id,
                              @RequestBody UpdateSubtaskRequest req) {
        Subtask subtask = subtasks.findOneById(id).orElseThrow(ApiException::notFound);
        Task task = taskService.requireById(subtask.getTaskId()); // 主任务归属校验（他人 RECORD → 404）
        Long actor = CurrentUser.id();
        Activity.Source source = RequestSource.current();
        if (req != null && req.title() != null) {
            if (req.title().isBlank()) {
                throw ApiException.badRequest("VALIDATION", "title must not be blank");
            }
            pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.SUBTASK_TITLE, "子任务标题");
            if (!req.title().equals(subtask.getTitle())) {
                recorder.record(task, actor, "SUBTASK_RENAMED", subtask.getTitle(), req.title(),
                        source);
                subtask.setTitle(req.title());
            }
        }
        if (req != null && req.done() != null && req.done() != subtask.isDone()) {
            subtask.setDone(req.done());
            if (req.done()) {
                // 完成留痕：谁、什么时候勾掉的；取消完成时清空
                subtask.setDoneAt(Instant.now());
                subtask.setDoneBy(actor);
                recorder.record(task, actor, "SUBTASK_DONE", null, subtask.getTitle(), source);
            } else {
                subtask.setDoneAt(null);
                subtask.setDoneBy(null);
                recorder.record(task, actor, "SUBTASK_UNDONE", null, subtask.getTitle(), source);
            }
        }
        if (req != null && req.rank() != null) {
            subtask.setRank(computeRank(task.getId(), req.rank()));
        }
        if (req != null && req.description() != null) {
            String v = req.description().value();
            pm.common.FieldLimits.check(v, pm.common.FieldLimits.SUBTASK_DESCRIPTION, "子任务描述");
            String nv = (v == null || v.isBlank()) ? null : v;
            // 描述变更不进时间线（blur 保存会刷屏），与任务图片上传一致
            subtask.setDescription(nv);
        }
        if (req != null && req.assigneeId() != null) {
            Long v = req.assigneeId().value();
            if (v != null && memberships
                    .findByUserIdAndTenantId(v, TenantContext.require()).isEmpty()) {
                throw ApiException.badRequest("INVALID_ASSIGNEE", "assignee 不是本租户成员");
            }
            if (!Objects.equals(subtask.getAssigneeId(), v)) {
                recorder.record(task, actor, "SUBTASK_ASSIGNED",
                        displayName(subtask.getAssigneeId()), displayName(v), source);
                subtask.setAssigneeId(v);
            }
        }
        if (req != null && req.dueDate() != null) {
            LocalDate v = parseDueDate(req.dueDate().value());
            if (!Objects.equals(subtask.getDueDate(), v)) {
                recorder.record(task, actor, "SUBTASK_DUE_CHANGED",
                        subtask.getDueDate() == null ? null : subtask.getDueDate().toString(),
                        v == null ? null : v.toString(), source);
                subtask.setDueDate(v);
            }
        }
        subtasks.save(subtask);
        taskRepo.touchUpdatedAt(task.getId());
        return SubtaskView.from(subtask);
    }

    @DeleteMapping("/api/t/{slug}/subtasks/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String slug, @PathVariable Long id) {
        Subtask subtask = subtasks.findOneById(id).orElseThrow(ApiException::notFound);
        Task task = taskService.requireById(subtask.getTaskId()); // 主任务归属校验（他人 RECORD → 404）
        recorder.record(task, CurrentUser.id(), "SUBTASK_DELETED", subtask.getTitle(), null,
                RequestSource.current());
        subtasks.delete(subtask);
        taskRepo.touchUpdatedAt(task.getId());
    }

    // ---------- 内部 ----------

    /** 拖拽排序：锚点必须是同一主任务下的子任务（防跨任务/跨租户串 rank）。 */
    private String computeRank(Long taskId, SubtaskRankMove move) {
        String after = move.afterId() == null ? null : requireSibling(taskId, move.afterId()).getRank();
        String before = move.beforeId() == null ? null : requireSibling(taskId, move.beforeId()).getRank();
        try {
            return rankService.between(after, before);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("INVALID_RANK_MOVE", e.getMessage());
        }
    }

    private Subtask requireSibling(Long taskId, Long subtaskId) {
        Subtask anchor = subtasks.findOneById(subtaskId).orElseThrow(ApiException::notFound);
        if (!anchor.getTaskId().equals(taskId)) {
            throw ApiException.badRequest("INVALID_RANK_MOVE", "排序锚点不属于该任务");
        }
        return anchor;
    }

    /** yyyy-MM-dd；空串/null → 置空；格式错 → 400。 */
    private static LocalDate parseDueDate(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(raw.strip());
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("VALIDATION", "到期日格式应为 yyyy-MM-dd");
        }
    }

    /** 时间线展示用：用户 id → 显示名（null/已删用户 → null，前端按「空」渲染）。 */
    private String displayName(Long userId) {
        if (userId == null) {
            return null;
        }
        return users.findById(userId).map(pm.user.User::getDisplayName)
                .orElse(null);
    }
}

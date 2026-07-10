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
import pm.common.ApiException;

import java.time.Instant;
import java.util.List;

/**
 * 子任务 REST（与评论一致：租户成员即可操作，无创建者限制）。
 * 子任务只挂在主任务下，taskId 经 TaskService.requireById 做租户归属校验（跨租户 404）。
 */
@RestController
public class SubtaskController {

    private final SubtaskRepository subtasks;
    private final TaskService taskService;

    public SubtaskController(SubtaskRepository subtasks, TaskService taskService) {
        this.subtasks = subtasks;
        this.taskService = taskService;
    }

    public record CreateSubtaskRequest(String title) {
    }

    public record UpdateSubtaskRequest(Boolean done, String title) {
    }

    public record SubtaskView(Long id, Long taskId, String title, boolean done, Instant createdAt) {
        static SubtaskView from(Subtask s) {
            return new SubtaskView(s.getId(), s.getTaskId(), s.getTitle(), s.isDone(),
                    s.getCreatedAt());
        }
    }

    @GetMapping("/api/t/{slug}/tasks/{taskId}/subtasks")
    @Transactional(readOnly = true)
    public List<SubtaskView> list(@PathVariable String slug, @PathVariable Long taskId) {
        taskService.requireById(taskId); // 归属校验（跨租户 404）
        return subtasks.findByTaskIdOrderByIdAsc(taskId).stream()
                .map(SubtaskView::from)
                .toList();
    }

    @PostMapping("/api/t/{slug}/tasks/{taskId}/subtasks")
    @Transactional
    public SubtaskView create(@PathVariable String slug, @PathVariable Long taskId,
                              @RequestBody CreateSubtaskRequest req) {
        if (req == null || req.title() == null || req.title().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "title is required");
        }
        pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.SUBTASK_TITLE, "子任务标题");
        taskService.requireById(taskId); // 归属校验（跨租户 404）
        Subtask subtask = subtasks.save(new Subtask(taskId, req.title()));
        return SubtaskView.from(subtask);
    }

    @PatchMapping("/api/t/{slug}/subtasks/{id}")
    @Transactional
    public SubtaskView update(@PathVariable String slug, @PathVariable Long id,
                              @RequestBody UpdateSubtaskRequest req) {
        Subtask subtask = subtasks.findOneById(id).orElseThrow(ApiException::notFound);
        if (req != null && req.title() != null) {
            if (req.title().isBlank()) {
                throw ApiException.badRequest("VALIDATION", "title must not be blank");
            }
            pm.common.FieldLimits.check(req.title(), pm.common.FieldLimits.SUBTASK_TITLE, "子任务标题");
            subtask.setTitle(req.title());
        }
        if (req != null && req.done() != null) {
            subtask.setDone(req.done());
        }
        subtasks.save(subtask);
        return SubtaskView.from(subtask);
    }

    @DeleteMapping("/api/t/{slug}/subtasks/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String slug, @PathVariable Long id) {
        Subtask subtask = subtasks.findOneById(id).orElseThrow(ApiException::notFound);
        subtasks.delete(subtask);
    }
}

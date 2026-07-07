package pm.comment;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.task.TaskService;

import java.time.Instant;
import java.util.List;

@RestController
public class CommentController {

    private final CommentRepository comments;
    private final TaskService taskService;

    public CommentController(CommentRepository comments, TaskService taskService) {
        this.comments = comments;
        this.taskService = taskService;
    }

    public record CreateCommentRequest(String body) {
    }

    public record CommentView(Long id, Long taskId, Long authorId, String body, Instant createdAt) {
        static CommentView from(Comment c) {
            return new CommentView(c.getId(), c.getTaskId(), c.getAuthorId(), c.getBody(),
                    c.getCreatedAt());
        }
    }

    @PostMapping("/api/t/{slug}/tasks/{id}/comments")
    @Transactional
    public CommentView create(@PathVariable String slug, @PathVariable Long id,
                              @RequestBody CreateCommentRequest req) {
        if (req == null || req.body() == null || req.body().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "body is required");
        }
        pm.common.FieldLimits.check(req.body(), pm.common.FieldLimits.COMMENT_BODY, "评论内容");
        taskService.requireById(id); // 归属校验（跨租户 404）
        Comment comment = comments.save(new Comment(id, CurrentUser.id(), req.body()));
        return CommentView.from(comment);
    }

    @GetMapping("/api/t/{slug}/tasks/{id}/comments")
    @Transactional(readOnly = true)
    public List<CommentView> list(@PathVariable String slug, @PathVariable Long id) {
        taskService.requireById(id);
        return comments.findByTaskIdOrderByCreatedAtAscIdAsc(id).stream()
                .map(CommentView::from)
                .toList();
    }
}

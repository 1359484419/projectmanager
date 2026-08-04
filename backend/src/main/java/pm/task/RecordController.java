package pm.task;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;

import java.time.Instant;
import java.util.List;

/** 记录模块：RECORD 列表、到期提醒轮询、手动关闭提醒。 */
@RestController
public class RecordController {

    private final TaskService taskService;

    public RecordController(TaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping("/api/t/{slug}/projects/{key}/records")
    List<TaskService.TaskView> records(@PathVariable String slug, @PathVariable String key) {
        return taskService.records(key, CurrentUser.id());
    }

    public record DueRecordView(Long id, String displayKey, String title, Instant remindAt) {
    }

    /** 到期未关闭的提醒（当前用户创建的记录，跨项目）；前端轮询，非空即弹框。 */
    @GetMapping("/api/t/{slug}/records/due")
    List<DueRecordView> due(@PathVariable String slug) {
        return taskService.dueRecords(CurrentUser.id()).stream()
                .map(r -> new DueRecordView(r.getId(), r.displayKey(), r.getTitle(), r.getRemindAt()))
                .toList();
    }

    /** 关闭提醒（幂等）：关闭后不再弹。 */
    @PostMapping("/api/t/{slug}/records/{id}/dismiss")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void dismiss(@PathVariable String slug, @PathVariable Long id) {
        taskService.dismissReminder(id);
    }
}

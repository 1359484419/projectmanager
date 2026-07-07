package pm.task;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;

import java.util.List;

@RestController
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    @PostMapping("/api/t/{slug}/projects/{key}/tasks")
    TaskService.TaskView create(@PathVariable String slug, @PathVariable String key,
                                @RequestBody TaskService.CreateTaskRequest req) {
        return taskService.create(key, req, CurrentUser.id(), Activity.Source.WEB);
    }

    @PatchMapping("/api/t/{slug}/tasks/{id}")
    TaskService.TaskView update(@PathVariable String slug, @PathVariable Long id,
                                @RequestBody TaskService.UpdateTaskRequest req) {
        return taskService.update(id, req, CurrentUser.id(), Activity.Source.WEB);
    }

    @GetMapping("/api/t/{slug}/projects/{key}/backlog")
    List<TaskService.TaskView> backlog(@PathVariable String slug, @PathVariable String key) {
        return taskService.backlog(key);
    }

    @GetMapping("/api/t/{slug}/tasks/{id}/activities")
    List<TaskService.ActivityView> activities(@PathVariable String slug, @PathVariable Long id) {
        return taskService.activities(id);
    }
}

package pm.task;

import org.springframework.stereotype.Component;
import pm.user.User;
import pm.user.UserRepository;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** TaskBrief 批量装配：一次查询解析负责人显示名 + 一次聚合查询子任务计数，避免各控制器 N+1。 */
@Component
public class TaskBriefs {

    private final UserRepository users;
    private final SubtaskRepository subtasks;

    public TaskBriefs(UserRepository users, SubtaskRepository subtasks) {
        this.users = users;
        this.subtasks = subtasks;
    }

    public List<TaskBrief> of(List<Task> tasks) {
        var ids = tasks.stream().map(Task::getAssigneeId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> names = ids.isEmpty() ? Map.of()
                : users.findAllById(ids).stream()
                        .collect(Collectors.toMap(User::getId, User::getDisplayName));
        Map<Long, SubtaskCount> counts = countMap(tasks);
        return tasks.stream()
                .map(t -> TaskBrief.from(t, nameOf(names, t), counts.get(t.getId())))
                .toList();
    }

    /** 已有列表按条件分组时复用同一份姓名映射与子任务计数。 */
    public Function<List<Task>, List<TaskBrief>> batch(List<Task> all) {
        var ids = all.stream().map(Task::getAssigneeId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> names = ids.isEmpty() ? Map.of()
                : users.findAllById(ids).stream()
                        .collect(Collectors.toMap(User::getId, User::getDisplayName));
        Map<Long, SubtaskCount> counts = countMap(all);
        return list -> list.stream()
                .map(t -> TaskBrief.from(t, nameOf(names, t), counts.get(t.getId())))
                .toList();
    }

    /** 子任务进度角标：一次 GROUP BY 聚合查询覆盖整批任务。 */
    private Map<Long, SubtaskCount> countMap(List<Task> tasks) {
        var taskIds = tasks.stream().map(Task::getId).toList();
        if (taskIds.isEmpty()) {
            return Map.of();
        }
        return subtasks.countByTaskIds(taskIds).stream()
                .collect(Collectors.toMap(SubtaskCount::getTaskId, c -> c));
    }

    /** Map.of() 等不可变 Map 对 get(null) 抛 NPE，未指派任务必须先判空。 */
    private static String nameOf(Map<Long, String> names, Task t) {
        return t.getAssigneeId() == null ? null : names.get(t.getAssigneeId());
    }
}

package pm.task;

import org.springframework.stereotype.Component;
import pm.user.User;
import pm.user.UserRepository;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** TaskBrief 批量装配：一次查询解析负责人显示名，避免各控制器 N+1。 */
@Component
public class TaskBriefs {

    private final UserRepository users;

    public TaskBriefs(UserRepository users) {
        this.users = users;
    }

    public List<TaskBrief> of(List<Task> tasks) {
        var ids = tasks.stream().map(Task::getAssigneeId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> names = ids.isEmpty() ? Map.of()
                : users.findAllById(ids).stream()
                        .collect(Collectors.toMap(User::getId, User::getDisplayName));
        return tasks.stream()
                .map(t -> TaskBrief.from(t, nameOf(names, t)))
                .toList();
    }

    /** 已有列表按条件分组时复用同一份姓名映射。 */
    public Function<List<Task>, List<TaskBrief>> batch(List<Task> all) {
        var ids = all.stream().map(Task::getAssigneeId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> names = ids.isEmpty() ? Map.of()
                : users.findAllById(ids).stream()
                        .collect(Collectors.toMap(User::getId, User::getDisplayName));
        return list -> list.stream()
                .map(t -> TaskBrief.from(t, nameOf(names, t)))
                .toList();
    }

    /** Map.of() 等不可变 Map 对 get(null) 抛 NPE，未指派任务必须先判空。 */
    private static String nameOf(Map<Long, String> names, Task t) {
        return t.getAssigneeId() == null ? null : names.get(t.getAssigneeId());
    }
}

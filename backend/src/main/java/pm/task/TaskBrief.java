package pm.task;

import java.math.BigDecimal;

/**
 * 任务摘要视图：roadmap / dashboard / all-sprints 等列表复用。
 */
public record TaskBrief(Long id, int seq, String title, Task.Type type, Task.Status status,
                        BigDecimal points, Long assigneeId) {

    public static TaskBrief from(Task t) {
        return new TaskBrief(t.getId(), t.getSeq(), t.getTitle(), t.getType(), t.getStatus(),
                t.getPoints(), t.getAssigneeId());
    }
}

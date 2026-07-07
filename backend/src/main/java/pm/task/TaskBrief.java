package pm.task;

import java.math.BigDecimal;

/**
 * 任务摘要视图：roadmap / dashboard / all-sprints 等列表复用。
 * description 为截断摘要（最长 {@link #DESC_MAX} 字符），列表卡片展示用。
 */
public record TaskBrief(Long id, int seq, String title, Task.Type type, Task.Status status,
                        BigDecimal points, Long assigneeId, String description) {

    /** 摘要截断长度。 */
    static final int DESC_MAX = 200;

    public static TaskBrief from(Task t) {
        return new TaskBrief(t.getId(), t.getSeq(), t.getTitle(), t.getType(), t.getStatus(),
                t.getPoints(), t.getAssigneeId(), snippet(t.getDescription()));
    }

    static String snippet(String description) {
        if (description == null || description.isBlank()) {
            return null;
        }
        String s = description.strip();
        return s.length() <= DESC_MAX ? s : s.substring(0, DESC_MAX) + "…";
    }
}

package pm.task;

import java.math.BigDecimal;

/**
 * 任务摘要视图：roadmap / dashboard / all-sprints 等列表复用。
 * description 为截断摘要（最长 {@link #DESC_MAX} 字符），列表卡片展示用。
 * subtaskDone/subtaskTotal：子任务进度角标（列表装配时填充；null 表示未装配）。
 */
public record TaskBrief(Long id, int seq, String title, Task.Type type, Task.Status status,
                        BigDecimal points, Long assigneeId, String assigneeName,
                        String description, Integer subtaskDone, Integer subtaskTotal) {

    /** 摘要截断长度。 */
    static final int DESC_MAX = 200;

    /** 不解析姓名的场景用；列表接口请走 {@link TaskBriefs} 批量装配以带上 assigneeName 与子任务计数。 */
    public static TaskBrief from(Task t) {
        return from(t, null);
    }

    public static TaskBrief from(Task t, String assigneeName) {
        return new TaskBrief(t.getId(), t.getSeq(), t.getTitle(), t.getType(), t.getStatus(),
                t.getPoints(), t.getAssigneeId(), assigneeName, snippet(t.getDescription()),
                null, null);
    }

    public static TaskBrief from(Task t, String assigneeName, SubtaskCount count) {
        return new TaskBrief(t.getId(), t.getSeq(), t.getTitle(), t.getType(), t.getStatus(),
                t.getPoints(), t.getAssigneeId(), assigneeName, snippet(t.getDescription()),
                count == null ? 0 : (int) count.getDone(),
                count == null ? 0 : (int) count.getTotal());
    }

    static String snippet(String description) {
        if (description == null || description.isBlank()) {
            return null;
        }
        String s = description.strip();
        return s.length() <= DESC_MAX ? s : s.substring(0, DESC_MAX) + "…";
    }
}

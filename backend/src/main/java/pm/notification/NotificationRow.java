package pm.notification;

import java.time.Instant;

/**
 * 通知下拉一行（查询 DTO，MyBatis 字段反射填充）：
 * JOIN tasks/projects 带出标题与 displayKey 所需字段，任务已删的通知不会出现（级联删除保证）。
 */
public class NotificationRow {

    private Long id;
    private Long taskId;
    private String type;
    private String taskTitle;
    private String projectKey;
    private int taskSeq;
    private Instant readAt;
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public Long getTaskId() {
        return taskId;
    }

    public String getType() {
        return type;
    }

    public String getTaskTitle() {
        return taskTitle;
    }

    public String getProjectKey() {
        return projectKey;
    }

    public int getTaskSeq() {
        return taskSeq;
    }

    public Instant getReadAt() {
        return readAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

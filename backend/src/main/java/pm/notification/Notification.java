package pm.notification;

import pm.tenant.TenantEntity;

import java.time.Instant;

/**
 * 站内通知：目前仅 TASK_ASSIGNED（任务指派给我）。
 * read_at NULL = 未读；只有在通知下拉里点击该条或"全部已读"才标已读，
 * 从看板等其他入口打开任务不影响未读状态（产品决策）。
 */
public class Notification extends TenantEntity {

    public enum Type { TASK_ASSIGNED }

    private Long id;

    private Long userId;

    private Long taskId;

    private Type type = Type.TASK_ASSIGNED;

    private Instant readAt;

    private Instant createdAt = Instant.now();

    protected Notification() {
    }

    public Notification(Long userId, Long taskId) {
        this.userId = userId;
        this.taskId = taskId;
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public Long getTaskId() {
        return taskId;
    }

    public Type getType() {
        return type;
    }

    public Instant getReadAt() {
        return readAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

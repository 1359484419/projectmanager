package pm.task;

import pm.tenant.TenantEntity;

import java.time.Instant;

/**
 * 任务变更历史。type：CREATED / STATUS_CHANGED / POINTS_CHANGED / SPRINT_CHANGED /
 * ASSIGNED / EPIC_CHANGED / TITLE_CHANGED / DESCRIPTION_CHANGED。
 */
public class Activity extends TenantEntity {

    public enum Source { WEB, MCP }

    private Long id;

    private Long taskId;

    /** null = 系统动作（如 Sprint 自动轮转 job）。 */
    private Long actorId;

    private String type;

    private String oldValue;

    private String newValue;

    private Source source = Source.WEB;

    private Instant at = Instant.now();

    protected Activity() {
    }

    public Activity(Long taskId, Long actorId, String type, String oldValue, String newValue, Source source) {
        this.taskId = taskId;
        this.actorId = actorId;
        this.type = type;
        this.oldValue = oldValue;
        this.newValue = newValue;
        this.source = source;
    }

    public Long getId() {
        return id;
    }

    public Long getTaskId() {
        return taskId;
    }

    public Long getActorId() {
        return actorId;
    }

    public String getType() {
        return type;
    }

    public String getOldValue() {
        return oldValue;
    }

    public String getNewValue() {
        return newValue;
    }

    public Source getSource() {
        return source;
    }

    public Instant getAt() {
        return at;
    }
}

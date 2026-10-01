package pm.task;

import pm.tenant.TenantEntity;

import java.time.Instant;

/**
 * 任务变更历史。type：CREATED / STATUS_CHANGED / POINTS_CHANGED / SPRINT_CHANGED /
 * ASSIGNED / EPIC_CHANGED / TITLE_CHANGED / DESCRIPTION_CHANGED /
 * SUBTASK_CREATED / SUBTASK_DONE / SUBTASK_UNDONE / SUBTASK_RENAMED / SUBTASK_DELETED /
 * SUBTASK_ASSIGNED / SUBTASK_DUE_CHANGED
 * （SUBTASK_* 挂在主任务上：增删改勾选的 old/newValue 承载子任务标题；
 * SUBTASK_ASSIGNED 承载负责人显示名，SUBTASK_DUE_CHANGED 承载 yyyy-MM-dd）。
 */
public class Activity extends TenantEntity {

    /** WEB：浏览器；MCP：PAT/MCP 工具；AGENT：自然语言助手（Python 服务以用户 JWT 回调并带 X-PM-Source: AGENT）。 */
    public enum Source { WEB, MCP, AGENT }

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

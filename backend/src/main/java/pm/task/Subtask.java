package pm.task;

import pm.tenant.TenantEntity;

import java.time.Instant;

/**
 * 子任务：只挂在主任务下（不进列表/看板），两态 done（完成/未开始）。
 */
public class Subtask extends TenantEntity {

    private Long id;

    private Long taskId;

    private String title;

    private boolean done;

    private Instant createdAt = Instant.now();

    protected Subtask() {
    }

    public Subtask(Long taskId, String title) {
        this.taskId = taskId;
        this.title = title;
    }

    public Long getId() {
        return id;
    }

    public Long getTaskId() {
        return taskId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public boolean isDone() {
        return done;
    }

    public void setDone(boolean done) {
        this.done = done;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

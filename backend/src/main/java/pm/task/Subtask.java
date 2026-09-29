package pm.task;

import pm.tenant.TenantEntity;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 子任务：只挂在主任务下（不进列表/看板），两态 done（完成/未开始）。
 * rank：字典序中点排序键（与 tasks.rank 同算法，支持拖拽排序）；
 * done_at/done_by：完成留痕（勾选完成时写入，取消完成时清空）；
 * description/assignee_id/due_date：详情字段（抽屉内联展开编辑）。
 */
public class Subtask extends TenantEntity {

    private Long id;

    private Long taskId;

    private String title;

    private boolean done;

    private String rank;

    private Instant doneAt;

    private Long doneBy;

    private String description;

    private Long assigneeId;

    private LocalDate dueDate;

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

    public String getRank() {
        return rank;
    }

    public void setRank(String rank) {
        this.rank = rank;
    }

    public Instant getDoneAt() {
        return doneAt;
    }

    public void setDoneAt(Instant doneAt) {
        this.doneAt = doneAt;
    }

    public Long getDoneBy() {
        return doneBy;
    }

    public void setDoneBy(Long doneBy) {
        this.doneBy = doneBy;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Long getAssigneeId() {
        return assigneeId;
    }

    public void setAssigneeId(Long assigneeId) {
        this.assigneeId = assigneeId;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

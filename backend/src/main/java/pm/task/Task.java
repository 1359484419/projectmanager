package pm.task;

import pm.tenant.TenantEntity;

import java.math.BigDecimal;
import java.time.Instant;

public class Task extends TenantEntity {

    public enum Type { STORY, BUG, TASK, RECORD }

    public enum Status { TODO, IN_PROGRESS, COMPLETED, DONE }

    private Long id;

    /** 乐观锁：并发编辑同一任务时后提交的旧快照 UPDATE 影响 0 行（→ 409），防丢更新。 */
    private long version;

    private Long projectId;

    private Long sprintId;

    private Long epicId;

    private Type type;

    private int seq;

    private String title;

    private String description;

    /** 故事点：0.5-5，0.5 的倍数（numeric(2,1)）。 */
    private BigDecimal points;

    private Long assigneeId;

    private Status status = Status.TODO;

    private String rank;

    private Long createdBy;

    private Instant createdAt = Instant.now();

    /** 最近一次写入时间（任何写路径都推进；日报按此取「今天改过的任务」）。 */
    private Instant updatedAt = createdAt;

    /** 最近一次状态流转时间：创建即 created_at，只有 status 真正变化才推进（日报「今日完成」按此取数）。 */
    private Instant statusChangedAt = createdAt;

    private Instant doneAt;

    /** 记录（RECORD）可选提醒：到期后前端右上角弹框，手动关闭置 reminderDismissed。 */
    private Instant remindAt;

    private boolean reminderDismissed;

    protected Task() {
    }

    public Task(Long projectId, Type type, int seq, String title, String rank) {
        this.projectId = projectId;
        this.type = type;
        this.seq = seq;
        this.title = title;
        this.rank = rank;
    }

    public Long getId() {
        return id;
    }

    public long getVersion() {
        return version;
    }

    public void setVersion(long version) {
        this.version = version;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getSprintId() {
        return sprintId;
    }

    public void setSprintId(Long sprintId) {
        this.sprintId = sprintId;
    }

    public Long getEpicId() {
        return epicId;
    }

    public void setEpicId(Long epicId) {
        this.epicId = epicId;
    }

    public Type getType() {
        return type;
    }

    public void setType(Type type) {
        this.type = type;
    }

    public int getSeq() {
        return seq;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public BigDecimal getPoints() {
        return points;
    }

    public void setPoints(BigDecimal points) {
        this.points = points;
    }

    public Long getAssigneeId() {
        return assigneeId;
    }

    public void setAssigneeId(Long assigneeId) {
        this.assigneeId = assigneeId;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public String getRank() {
        return rank;
    }

    public void setRank(String rank) {
        this.rank = rank;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(Long createdBy) {
        this.createdBy = createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Instant getStatusChangedAt() {
        return statusChangedAt;
    }

    public void setStatusChangedAt(Instant statusChangedAt) {
        this.statusChangedAt = statusChangedAt;
    }

    public Instant getDoneAt() {
        return doneAt;
    }

    public void setDoneAt(Instant doneAt) {
        this.doneAt = doneAt;
    }

    public Instant getRemindAt() {
        return remindAt;
    }

    public void setRemindAt(Instant remindAt) {
        this.remindAt = remindAt;
    }

    public boolean isReminderDismissed() {
        return reminderDismissed;
    }

    public void setReminderDismissed(boolean reminderDismissed) {
        this.reminderDismissed = reminderDismissed;
    }
}

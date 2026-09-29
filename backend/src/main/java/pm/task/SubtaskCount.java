package pm.task;

/** 子任务进度聚合计数行（MyBatis 结果映射：task_id → taskId）。 */
public class SubtaskCount {

    private Long taskId;
    private long total;
    private long done;

    public Long getTaskId() {
        return taskId;
    }

    public void setTaskId(Long taskId) {
        this.taskId = taskId;
    }

    public long getTotal() {
        return total;
    }

    public void setTotal(long total) {
        this.total = total;
    }

    public long getDone() {
        return done;
    }

    public void setDone(long done) {
        this.done = done;
    }
}

package pm.task;

import java.time.Instant;

/** 到期提醒行（MyBatis 结果映射，projects.key 拼 displayKey）。 */
public class DueRecordRow {

    private Long id;
    private String title;
    private Instant remindAt;
    private int seq;
    private String projectKey;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Instant getRemindAt() {
        return remindAt;
    }

    public void setRemindAt(Instant remindAt) {
        this.remindAt = remindAt;
    }

    public int getSeq() {
        return seq;
    }

    public void setSeq(int seq) {
        this.seq = seq;
    }

    public String getProjectKey() {
        return projectKey;
    }

    public void setProjectKey(String projectKey) {
        this.projectKey = projectKey;
    }

    public String displayKey() {
        return projectKey + "-" + seq;
    }
}

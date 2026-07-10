package pm.comment;

import pm.tenant.TenantEntity;

import java.time.Instant;

public class Comment extends TenantEntity {

    private Long id;

    private Long taskId;

    private Long authorId;

    private String body;

    private Instant createdAt = Instant.now();

    protected Comment() {
    }

    public Comment(Long taskId, Long authorId, String body) {
        this.taskId = taskId;
        this.authorId = authorId;
        this.body = body;
    }

    public Long getId() {
        return id;
    }

    public Long getTaskId() {
        return taskId;
    }

    public Long getAuthorId() {
        return authorId;
    }

    public String getBody() {
        return body;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

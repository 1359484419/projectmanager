package pm.comment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import pm.tenant.TenantEntity;

import java.time.Instant;

@Entity
@Table(name = "comments")
@Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
public class Comment extends TenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @Column(name = "author_id", nullable = false)
    private Long authorId;

    @Column(nullable = false)
    private String body;

    @Column(name = "created_at", nullable = false)
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

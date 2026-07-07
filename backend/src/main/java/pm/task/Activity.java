package pm.task;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import pm.tenant.TenantEntity;

import java.time.Instant;

/**
 * 任务变更历史。type：CREATED / STATUS_CHANGED / POINTS_CHANGED / SPRINT_CHANGED /
 * ASSIGNED / EPIC_CHANGED / TITLE_CHANGED / DESCRIPTION_CHANGED。
 */
@Entity
@Table(name = "activities")
@Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
public class Activity extends TenantEntity {

    public enum Source { WEB, MCP }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @Column(name = "actor_id", nullable = false)
    private Long actorId;

    @Column(nullable = false)
    private String type;

    @Column(name = "old_value")
    private String oldValue;

    @Column(name = "new_value")
    private String newValue;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Source source = Source.WEB;

    @Column(name = "at", nullable = false)
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

package pm.sprint;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import pm.tenant.TenantEntity;

@Entity
@Table(name = "capacity_overrides")
@Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
public class CapacityOverride extends TenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "sprint_id", nullable = false)
    private Long sprintId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private int capacity;

    protected CapacityOverride() {
    }

    public CapacityOverride(Long sprintId, Long userId, int capacity) {
        this.sprintId = sprintId;
        this.userId = userId;
        this.capacity = capacity;
    }

    public Long getId() {
        return id;
    }

    public Long getSprintId() {
        return sprintId;
    }

    public Long getUserId() {
        return userId;
    }

    public int getCapacity() {
        return capacity;
    }

    public void setCapacity(int capacity) {
        this.capacity = capacity;
    }
}

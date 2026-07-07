package pm.project;

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

@Entity
@Table(name = "projects")
@Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
public class Project extends TenantEntity {

    public enum SprintLength { WEEK_1, WEEK_2, MONTH_1 }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "key", nullable = false)
    private String key;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "default_sprint_length", nullable = false)
    private SprintLength defaultSprintLength = SprintLength.WEEK_2;

    @Column(name = "auto_rotate", nullable = false)
    private boolean autoRotate = true;

    protected Project() {
    }

    public Project(String key, String name) {
        this.key = key;
        this.name = name;
    }

    public Long getId() {
        return id;
    }

    public String getKey() {
        return key;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public SprintLength getDefaultSprintLength() {
        return defaultSprintLength;
    }

    public void setDefaultSprintLength(SprintLength defaultSprintLength) {
        this.defaultSprintLength = defaultSprintLength;
    }

    public boolean isAutoRotate() {
        return autoRotate;
    }

    public void setAutoRotate(boolean autoRotate) {
        this.autoRotate = autoRotate;
    }
}

package pm.epic;

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
@Table(name = "epics")
@Filter(name = TenantEntity.TENANT_FILTER, condition = "tenant_id = :tenantId")
public class Epic extends TenantEntity {

    public enum Status { OPEN, DONE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false)
    private String name;

    private String description;

    /** 形如 2026-Q3，可空（未排期）。 */
    private String quarter;

    private String color;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.OPEN;

    protected Epic() {
    }

    public Epic(Long projectId, String name, String description, String quarter, String color) {
        this.projectId = projectId;
        this.name = name;
        this.description = description;
        this.quarter = quarter;
        this.color = color;
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getQuarter() {
        return quarter;
    }

    public void setQuarter(String quarter) {
        this.quarter = quarter;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }
}

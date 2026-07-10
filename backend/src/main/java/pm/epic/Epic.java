package pm.epic;

import pm.tenant.TenantEntity;

/** 纯 POJO（MyBatis 映射，原 JPA 实体）。对应表 epics。 */
public class Epic extends TenantEntity {

    public enum Status { OPEN, DONE }

    private Long id;

    private Long projectId;

    private String name;

    private String description;

    /** 形如 2026-Q3，可空（未排期）。 */
    private String quarter;

    private String color;

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

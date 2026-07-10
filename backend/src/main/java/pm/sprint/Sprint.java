package pm.sprint;

import pm.project.Project;
import pm.tenant.TenantEntity;

import java.time.LocalDate;

/** 纯 POJO（MyBatis 映射，SQL 见 mapper/SprintMapper.xml），表 sprints。 */
public class Sprint extends TenantEntity {

    public enum Status { PLANNED, ACTIVE, CLOSED }

    private Long id;

    private Long projectId;

    private String name;

    private Project.SprintLength length;

    private LocalDate startDate;

    private LocalDate endDate;

    private Status status = Status.PLANNED;

    protected Sprint() {
    }

    public Sprint(Long projectId, String name, Project.SprintLength length,
                  LocalDate startDate, LocalDate endDate) {
        this.projectId = projectId;
        this.name = name;
        this.length = length;
        this.startDate = startDate;
        this.endDate = endDate;
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

    public Project.SprintLength getLength() {
        return length;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public LocalDate getEndDate() {
        return endDate;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }
}

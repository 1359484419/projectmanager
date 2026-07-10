package pm.project;

import pm.tenant.TenantEntity;

/** 纯 POJO（MyBatis 映射，原 JPA 实体）。对应表 projects。 */
public class Project extends TenantEntity {

    public enum SprintLength { WEEK_1, WEEK_2, MONTH_1 }

    private Long id;

    private String key;

    private String name;

    private SprintLength defaultSprintLength = SprintLength.WEEK_2;

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

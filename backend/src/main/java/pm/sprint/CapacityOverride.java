package pm.sprint;

import pm.tenant.TenantEntity;

/** 纯 POJO（MyBatis 映射，SQL 见 mapper/CapacityOverrideMapper.xml），表 capacity_overrides。 */
public class CapacityOverride extends TenantEntity {

    private Long id;

    private Long sprintId;

    private Long userId;

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

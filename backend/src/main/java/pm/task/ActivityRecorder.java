package pm.task;

import org.springframework.stereotype.Component;

/**
 * 所有任务可变字段变更的统一留痕入口（harness：业务代码不得直接写 activities 表）。
 */
@Component
public class ActivityRecorder {

    private final ActivityRepository activities;

    public ActivityRecorder(ActivityRepository activities) {
        this.activities = activities;
    }

    public void record(Task task, long actor, String type, String oldValue, String newValue,
                       Activity.Source source) {
        activities.save(new Activity(task.getId(), actor, type, oldValue, newValue, source));
    }
}

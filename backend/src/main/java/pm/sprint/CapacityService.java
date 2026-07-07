package pm.sprint;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.WorkdayCalculator;
import pm.task.Task;
import pm.task.TaskRepository;
import pm.tenantadmin.Membership;
import pm.tenantadmin.MembershipRepository;
import pm.user.User;
import pm.user.UserRepository;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 按人容量：默认 = Sprint 起止的工作日数（1 point = 1 人天），
 * capacity_overrides 命中则用 override；assignedPoints = 该 Sprint 内指派任务 points 和。
 * 容量提示性，不硬阻止超配。
 */
@Service
public class CapacityService {

    private final SprintService sprintService;
    private final CapacityOverrideRepository overrides;
    private final MembershipRepository memberships;
    private final UserRepository users;
    private final TaskRepository tasks;

    public CapacityService(SprintService sprintService, CapacityOverrideRepository overrides,
                           MembershipRepository memberships, UserRepository users,
                           TaskRepository tasks) {
        this.sprintService = sprintService;
        this.overrides = overrides;
        this.memberships = memberships;
        this.users = users;
        this.tasks = tasks;
    }

    public record CapacityRow(Long userId, String displayName, int capacity,
                              BigDecimal assignedPoints) {
    }

    @Transactional(readOnly = true)
    public List<CapacityRow> capacity(Long sprintId) {
        Sprint sprint = sprintService.requireById(sprintId);
        int defaultCapacity = WorkdayCalculator.workdays(sprint.getStartDate(), sprint.getEndDate());

        Map<Long, Integer> overrideByUser = overrides.findBySprintId(sprintId).stream()
                .collect(Collectors.toMap(CapacityOverride::getUserId, CapacityOverride::getCapacity));
        Map<Long, BigDecimal> assignedByUser = tasks.findBySprintIdOrderByRankAsc(sprintId).stream()
                .filter(t -> t.getAssigneeId() != null)
                .collect(Collectors.groupingBy(Task::getAssigneeId,
                        Collectors.reducing(BigDecimal.ZERO,
                                t -> t.getPoints() == null ? BigDecimal.ZERO : t.getPoints(),
                                BigDecimal::add)));

        List<Membership> members = memberships.findByTenantId(sprint.getTenantId());
        Map<Long, User> userById = users
                .findAllById(members.stream().map(Membership::getUserId).toList()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        return members.stream()
                .sorted(Comparator.comparing(Membership::getUserId))
                .map(m -> new CapacityRow(m.getUserId(),
                        userById.get(m.getUserId()).getDisplayName(),
                        overrideByUser.getOrDefault(m.getUserId(), defaultCapacity),
                        assignedByUser.getOrDefault(m.getUserId(), BigDecimal.ZERO)))
                .toList();
    }

    @Transactional
    public CapacityRow upsertOverride(Long sprintId, Long userId, int capacity) {
        sprintService.requireById(sprintId); // 归属校验（跨租户 404）
        CapacityOverride override = overrides.findBySprintIdAndUserId(sprintId, userId)
                .orElseGet(() -> new CapacityOverride(sprintId, userId, capacity));
        override.setCapacity(capacity);
        overrides.save(override);
        return capacity(sprintId).stream()
                .filter(r -> r.userId().equals(userId))
                .findFirst()
                .orElse(new CapacityRow(userId, null, capacity, BigDecimal.ZERO));
    }
}

package pm.tenantadmin;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.ApiException;
import pm.mcp.ApiTokenRepository;
import pm.task.Activity;
import pm.task.ActivityRecorder;
import pm.task.Task;
import pm.task.TaskRepository;
import pm.tenant.TenantContext;

@Service
public class MemberService {

    private final MembershipRepository memberships;
    private final ApiTokenRepository apiTokens;
    private final TaskRepository tasks;
    private final ActivityRecorder recorder;

    public MemberService(MembershipRepository memberships, ApiTokenRepository apiTokens,
                         TaskRepository tasks, ActivityRecorder recorder) {
        this.memberships = memberships;
        this.apiTokens = apiTokens;
        this.tasks = tasks;
        this.recorder = recorder;
    }

    /**
     * 移除成员（仅 ADMIN；MEMBER 视为管理资源不存在 → 404）。
     * 约束：不能移除自己（409 CANNOT_REMOVE_SELF）；不能移除租户最后一个 ADMIN（409 LAST_ADMIN，
     * REST 正常流程撞不到——操作者本人是 ADMIN 且不能删自己——留作数据异常/并发下的防御）。
     * 执行：删 membership、删该用户在本租户的 PAT、其非 DONE 任务 assignee 置 NULL 并逐条留痕
     * （ASSIGNED，actor=操作者）。任务查询依赖请求级 tenantFilter（TenantInterceptor 已开启）。
     */
    @Transactional
    public void remove(Long targetUserId, Long actorUserId) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw ApiException.notFound();
        }
        long tenantId = TenantContext.require();
        Membership target = memberships.findByUserIdAndTenantId(targetUserId, tenantId)
                .orElseThrow(ApiException::notFound);
        if (targetUserId.equals(actorUserId)) {
            throw ApiException.conflict("CANNOT_REMOVE_SELF", "cannot remove yourself");
        }
        if (target.getRole() == Membership.Role.ADMIN
                && memberships.countByTenantIdAndRole(tenantId, Membership.Role.ADMIN) <= 1) {
            throw ApiException.conflict("LAST_ADMIN", "cannot remove the last admin of the tenant");
        }

        memberships.delete(target);
        apiTokens.deleteByUserIdAndTenantId(targetUserId, tenantId);
        for (Task task : tasks.findByAssigneeIdAndStatusNot(targetUserId, Task.Status.DONE)) {
            recorder.record(task, actorUserId, "ASSIGNED",
                    String.valueOf(targetUserId), null, Activity.Source.WEB);
            task.setAssigneeId(null);
            tasks.save(task); // MyBatis 无 JPA 脏检查，显式落库
        }
    }
}

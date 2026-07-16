package pm.project;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.common.ApiException;
import pm.tenant.TenantContext;
import pm.tenantadmin.Membership;

import java.util.List;
import java.util.regex.Pattern;

@Service
public class ProjectService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[A-Z]{2,6}$");

    private final ProjectRepository projects;
    private final pm.task.TaskRepository tasks;
    private final pm.task.ActivityRepository activityRepo;
    private final pm.comment.CommentRepository commentRepo;
    private final pm.task.SubtaskRepository subtaskRepo;
    private final pm.sprint.SprintRepository sprints;
    private final pm.sprint.CapacityOverrideRepository capacityOverrides;
    private final pm.epic.EpicRepository epics;
    private final pm.notification.NotificationService notifications;

    public record ProjectView(Long id, String key, String name,
                              Project.SprintLength defaultSprintLength, boolean autoRotate) {
        static ProjectView from(Project p) {
            return new ProjectView(p.getId(), p.getKey(), p.getName(),
                    p.getDefaultSprintLength(), p.isAutoRotate());
        }
    }

    public ProjectService(ProjectRepository projects, pm.task.TaskRepository tasks,
                          pm.task.ActivityRepository activityRepo,
                          pm.comment.CommentRepository commentRepo,
                          pm.task.SubtaskRepository subtaskRepo,
                          pm.sprint.SprintRepository sprints,
                          pm.sprint.CapacityOverrideRepository capacityOverrides,
                          pm.epic.EpicRepository epics,
                          pm.notification.NotificationService notifications) {
        this.projects = projects;
        this.tasks = tasks;
        this.activityRepo = activityRepo;
        this.commentRepo = commentRepo;
        this.subtaskRepo = subtaskRepo;
        this.sprints = sprints;
        this.capacityOverrides = capacityOverrides;
        this.epics = epics;
        this.notifications = notifications;
    }

    /** 仅 ADMIN；MEMBER 视为管理操作不存在 → 404（与 PATCH 一致）。 */
    @Transactional
    public ProjectView create(String key, String name) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw ApiException.notFound();
        }
        if (key == null || !KEY_PATTERN.matcher(key).matches()) {
            throw ApiException.badRequest("INVALID_KEY", "key must be 2-6 uppercase letters");
        }
        if (name == null || name.isBlank()) {
            throw ApiException.badRequest("VALIDATION", "name is required");
        }
        pm.common.FieldLimits.check(name, pm.common.FieldLimits.PROJECT_NAME, "项目名称");
        if (projects.existsByKey(key)) {
            throw ApiException.conflict("KEY_TAKEN", "project key already exists");
        }
        return ProjectView.from(projects.save(new Project(key, name)));
    }

    @Transactional(readOnly = true)
    public List<ProjectView> list() {
        return projects.findAllByOrderByIdAsc().stream().map(ProjectView::from).toList();
    }

    @Transactional(readOnly = true)
    public Project requireByKey(String key) {
        return projects.findByKey(key).orElseThrow(ApiException::notFound);
    }

    /** 仅 ADMIN；MEMBER 视为管理操作不存在 → 404。 */
    @Transactional
    public ProjectView update(String key, String name, Project.SprintLength defaultSprintLength,
                              Boolean autoRotate) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw ApiException.notFound();
        }
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        if (name != null) {
            pm.common.FieldLimits.check(name, pm.common.FieldLimits.PROJECT_NAME, "项目名称");
            project.setName(name);
        }
        if (defaultSprintLength != null) {
            project.setDefaultSprintLength(defaultSprintLength);
        }
        if (autoRotate != null) {
            project.setAutoRotate(autoRotate);
        }
        // MyBatis 无 JPA 脏检查：修改后显式落库
        return ProjectView.from(projects.save(project));
    }

    /**
     * 删除项目（仅租户 ADMIN，MEMBER → 403）：级联清理项目下全部数据。
     * 顺序（先子后父，避免悬挂引用）：
     * activities/comments/subtasks（按任务批量）→ tasks → capacity_overrides（按 sprint）
     * → sprints → epics → project。整体一个事务，一起成一起败。
     */
    @Transactional
    public void delete(String key) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw ApiException.forbidden("FORBIDDEN", "仅管理员可以删除项目");
        }
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        List<Long> taskIds = tasks.findIdsByProjectId(project.getId());
        if (!taskIds.isEmpty()) {
            activityRepo.deleteByTaskIdIn(taskIds);
            commentRepo.deleteByTaskIdIn(taskIds);
            taskIds.forEach(subtaskRepo::deleteByTaskId);
            notifications.deleteByTasks(taskIds);
        }
        tasks.deleteByProjectId(project.getId());
        List<Long> sprintIds = sprints.findByProjectIdOrderByIdDesc(project.getId()).stream()
                .map(pm.sprint.Sprint::getId).toList();
        if (!sprintIds.isEmpty()) {
            capacityOverrides.deleteBySprintIdIn(sprintIds);
        }
        sprints.deleteByProjectId(project.getId());
        epics.deleteByProjectId(project.getId());
        projects.deleteById(project.getId());
    }
}

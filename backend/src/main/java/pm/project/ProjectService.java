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

    public record ProjectView(Long id, String key, String name,
                              Project.SprintLength defaultSprintLength, boolean autoRotate) {
        static ProjectView from(Project p) {
            return new ProjectView(p.getId(), p.getKey(), p.getName(),
                    p.getDefaultSprintLength(), p.isAutoRotate());
        }
    }

    public ProjectService(ProjectRepository projects) {
        this.projects = projects;
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
        return ProjectView.from(project);
    }
}

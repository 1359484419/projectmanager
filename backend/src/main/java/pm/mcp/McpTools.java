package pm.mcp;

import jakarta.persistence.EntityManager;
import org.hibernate.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.epic.EpicRepository;
import pm.project.Project;
import pm.project.ProjectRepository;
import pm.sprint.Sprint;
import pm.sprint.SprintRepository;
import pm.sprint.SprintService;
import pm.task.Activity;
import pm.task.Task;
import pm.task.TaskRepository;
import pm.task.TaskService;
import pm.tenant.TenantContext;
import pm.tenant.TenantEntity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * MCP 工具的业务实现（service 层，协议层见 McpConfig）。
 * harness 说明：/mcp 由 SDK 的 Servlet 直接处理、不经 DispatcherServlet，
 * TenantInterceptor（OSIV session 上开 tenantFilter）不生效；
 * 因此每个工具方法自带 @Transactional 并在入口对当前事务 session 开启 tenantFilter，
 * 租户上下文来自 PatAuthFilter 设置的 TenantContext（PAT 天然绑租户）。
 */
@Service
public class McpTools {

    public static final int BATCH_LIMIT = 20;

    private final ProjectRepository projects;
    private final SprintRepository sprints;
    private final EpicRepository epics;
    private final TaskRepository tasks;
    private final TaskService taskService;
    private final SprintService sprintService;
    private final EntityManager entityManager;

    public McpTools(ProjectRepository projects, SprintRepository sprints, EpicRepository epics,
                    TaskRepository tasks, TaskService taskService, SprintService sprintService,
                    EntityManager entityManager) {
        this.projects = projects;
        this.sprints = sprints;
        this.epics = epics;
        this.tasks = tasks;
        this.taskService = taskService;
        this.sprintService = sprintService;
        this.entityManager = entityManager;
    }

    public record ProjectItem(String key, String name) {
    }

    public record TaskInput(Task.Type type, String title, String description, BigDecimal points, Long epicId) {
    }

    public record CreatedTask(String seq, String title) {
    }

    // ---------- 读 ----------

    @Transactional(readOnly = true)
    public List<ProjectItem> listProjects() {
        enableTenantFilter();
        return projects.findAllByOrderByIdAsc().stream()
                .map(p -> new ProjectItem(p.getKey(), p.getName()))
                .toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> listSprints(String projectKey) {
        enableTenantFilter();
        Project project = requireProject(projectKey);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("active", sprints.findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE)
                .map(McpTools::sprintBrief).orElse(null));
        result.put("next", sprints
                .findFirstByProjectIdAndStatusOrderByStartDateAsc(project.getId(), Sprint.Status.PLANNED)
                .map(McpTools::sprintBrief).orElse(null));
        result.put("recent", sprints
                .findTop5ByProjectIdAndStatusOrderByEndDateDesc(project.getId(), Sprint.Status.CLOSED)
                .stream().map(McpTools::sprintBrief).toList());
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listEpics(String projectKey) {
        enableTenantFilter();
        Project project = requireProject(projectKey);
        return epics.findByProjectIdOrderByIdAsc(project.getId()).stream()
                .map(e -> {
                    Map<String, Object> m = new LinkedHashMap<String, Object>();
                    m.put("id", e.getId());
                    m.put("name", e.getName());
                    m.put("quarter", e.getQuarter());
                    m.put("status", e.getStatus().name());
                    return m;
                })
                .toList();
    }

    /** 我在当前/上个 Sprint 的任务（agent 生成日报/周报用）。无对应 Sprint 返回空列表。 */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> listMyTasks(String projectKey, String sprint) {
        enableTenantFilter();
        Project project = requireProject(projectKey);
        String which = sprint == null ? "current" : sprint.toLowerCase(Locale.ROOT);
        Sprint target = switch (which) {
            case "current" -> sprints.findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE)
                    .orElse(null);
            case "previous" -> sprints
                    .findTop5ByProjectIdAndStatusOrderByEndDateDesc(project.getId(), Sprint.Status.CLOSED)
                    .stream().findFirst().orElse(null);
            default -> throw ApiException.badRequest("VALIDATION", "sprint must be 'current' or 'previous'");
        };
        if (target == null) {
            return List.of();
        }
        long me = CurrentUser.id();
        return tasks.findBySprintIdOrderByRankAsc(target.getId()).stream()
                .filter(t -> Objects.equals(t.getAssigneeId(), me))
                .map(t -> {
                    Map<String, Object> m = new LinkedHashMap<String, Object>();
                    m.put("seq", project.getKey() + "-" + t.getSeq());
                    m.put("title", t.getTitle());
                    m.put("type", t.getType().name());
                    m.put("status", t.getStatus().name());
                    m.put("points", t.getPoints());
                    return m;
                })
                .toList();
    }

    // ---------- 写 ----------

    /**
     * 批量创建任务（≤20 条）。target: current_sprint | next_sprint | backlog。
     * next_sprint 无 PLANNED 时按项目默认周期预建（start = 当前 ACTIVE end + 1）。
     * 默认 assignee = PAT 用户；activities 标 source=MCP。
     */
    @Transactional
    public List<CreatedTask> createTasks(String projectKey, String target, List<TaskInput> inputs) {
        enableTenantFilter();
        if (inputs == null || inputs.isEmpty()) {
            throw ApiException.badRequest("VALIDATION", "tasks must not be empty");
        }
        if (inputs.size() > BATCH_LIMIT) {
            throw ApiException.badRequest("BATCH_LIMIT",
                    "at most " + BATCH_LIMIT + " tasks per call, got " + inputs.size());
        }
        Project project = requireProject(projectKey);
        Long sprintId = resolveTarget(project, target);
        long actor = CurrentUser.id();
        List<CreatedTask> created = new ArrayList<>();
        for (TaskInput input : inputs) {
            TaskService.TaskView view = taskService.create(project.getKey(),
                    new TaskService.CreateTaskRequest(input.type(), input.title(), input.description(),
                            input.points(), input.epicId(), sprintId, actor),
                    actor, Activity.Source.MCP);
            created.add(new CreatedTask(view.displayKey(), view.title()));
        }
        return created;
    }

    /** 按展示号（如 PM-42）推进任务状态。 */
    @Transactional
    public Map<String, Object> updateTaskStatus(String taskSeq, String status) {
        enableTenantFilter();
        if (taskSeq == null || !taskSeq.contains("-")) {
            throw ApiException.badRequest("VALIDATION", "taskSeq must look like PM-42");
        }
        int dash = taskSeq.lastIndexOf('-');
        String key = taskSeq.substring(0, dash).toUpperCase(Locale.ROOT);
        int seq;
        try {
            seq = Integer.parseInt(taskSeq.substring(dash + 1));
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("VALIDATION", "taskSeq must look like PM-42");
        }
        Task.Status newStatus;
        try {
            newStatus = Task.Status.valueOf(status == null ? "" : status.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("VALIDATION",
                    "status must be one of TODO, IN_PROGRESS, COMPLETED, DONE");
        }
        Project project = requireProject(key);
        Task task = tasks.findByProjectIdAndSeq(project.getId(), seq).orElseThrow(ApiException::notFound);
        taskService.changeStatus(task, newStatus, CurrentUser.id(), Activity.Source.MCP);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("seq", taskSeq.toUpperCase(Locale.ROOT));
        result.put("status", task.getStatus().name());
        result.put("doneAt", task.getDoneAt());
        return result;
    }

    // ---------- 内部 ----------

    private Long resolveTarget(Project project, String target) {
        String t = target == null ? "" : target.toLowerCase(Locale.ROOT);
        return switch (t) {
            case "backlog" -> null;
            case "current_sprint" -> sprints
                    .findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE)
                    .orElseThrow(() -> ApiException.badRequest("NO_ACTIVE_SPRINT",
                            "project " + project.getKey() + " has no active sprint"))
                    .getId();
            case "next_sprint" -> sprints
                    .findFirstByProjectIdAndStatusOrderByStartDateAsc(project.getId(), Sprint.Status.PLANNED)
                    .map(Sprint::getId)
                    .orElseGet(() -> {
                        LocalDate start = sprints
                                .findByProjectIdAndStatus(project.getId(), Sprint.Status.ACTIVE)
                                .map(a -> a.getEndDate().plusDays(1))
                                .orElse(pm.common.BizTime.today());
                        return sprintService.create(project.getKey(),
                                new SprintService.CreateSprintRequest(null, null, start)).id();
                    });
            default -> throw ApiException.badRequest("VALIDATION",
                    "target must be one of current_sprint, next_sprint, backlog");
        };
    }

    private Project requireProject(String projectKey) {
        return projects.findByKey(projectKey).orElseThrow(ApiException::notFound);
    }

    private static Map<String, Object> sprintBrief(Sprint s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.getId());
        m.put("name", s.getName());
        m.put("startDate", s.getStartDate().toString());
        m.put("endDate", s.getEndDate().toString());
        m.put("status", s.getStatus().name());
        return m;
    }

    /**
     * harness：在当前事务 session 上开启租户过滤（/mcp 不经 TenantInterceptor）。
     * TenantContext 由 PatAuthFilter（或测试）设置；未设置 → 404 语义。
     */
    private void enableTenantFilter() {
        long tenantId = TenantContext.require();
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter(TenantEntity.TENANT_FILTER).setParameter("tenantId", tenantId);
    }
}

package pm.mcp;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;
import pm.common.ApiException;
import pm.sprint.Sprint;
import pm.sprint.SprintRepository;
import pm.task.Activity;
import pm.task.ActivityRepository;
import pm.task.Task;
import pm.task.TaskRepository;
import pm.tenant.TenantContext;
import pm.tenantadmin.Membership;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.TenantRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * MCP 工具（service 层直测，不走协议层）：批量上限、next_sprint 预建、
 * activity source=MCP、update_task_status 写 done_at。
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class McpToolsTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;
    @Autowired
    McpTools mcpTools;
    @Autowired
    TenantRepository tenants;
    @Autowired
    MembershipRepository memberships;
    @Autowired
    SprintRepository sprints;
    @Autowired
    TaskRepository tasks;
    @Autowired
    ActivityRepository activities;
    @Autowired
    pm.project.ProjectRepository projects;

    TwoTenantsFixture fx;
    long tenantId;
    long userId;
    long activeSprintId;
    LocalDate activeEnd;

    @BeforeAll
    void setup() {
        fx = new TwoTenantsFixture(rest);
        // 项目 + ACTIVE Sprint（今天起 2 周）
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/projects", Map.of("key", "MCP", "name", "Mcp Project"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> s = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/projects/MCP/sprints",
                Map.of("startDate", LocalDate.now().toString()));
        assertThat(s.getStatusCode().value()).isEqualTo(200);
        activeSprintId = ((Number) s.getBody().get("id")).longValue();
        activeEnd = LocalDate.parse((String) s.getBody().get("endDate"));
        ResponseEntity<Map> start = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/sprints/" + activeSprintId + "/start", null);
        assertThat(start.getStatusCode().value()).isEqualTo(200);

        tenantId = tenants.findBySlug(fx.slugA).orElseThrow().getId();
        Membership m = memberships.findByTenantId(tenantId).get(0);
        userId = m.getUserId();
    }

    @BeforeEach
    void actAsPatUser() {
        // 模拟 PatAuthFilter：注入用户身份 + 租户上下文
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(userId, null, List.of()));
        TenantContext.set(tenantId, Membership.Role.ADMIN);
    }

    @AfterEach
    void cleanup() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void createTasksRejectsBatchOver20() {
        List<McpTools.TaskInput> batch = IntStream.rangeClosed(1, 21)
                .mapToObj(i -> new McpTools.TaskInput(Task.Type.TASK, "t" + i, null, null, null))
                .toList();
        assertThatThrownBy(() -> mcpTools.createTasks("MCP", "backlog", batch))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("BATCH_LIMIT"));
    }

    @Test
    void createTasksNextSprintAutoCreatesPlannedAndMarksMcpSource() {
        List<McpTools.CreatedTask> created = mcpTools.createTasks("MCP", "next_sprint", List.of(
                new McpTools.TaskInput(Task.Type.STORY, "story via mcp", "desc", 3, null)));
        assertThat(created).hasSize(1);
        assertThat(created.get(0).seq()).startsWith("MCP-");

        // 自动预建 PLANNED sprint：start = 当前 ACTIVE end + 1
        Sprint planned = sprints.findByProjectIdOrderByIdDesc(projectId()).stream()
                .filter(s -> s.getStatus() == Sprint.Status.PLANNED)
                .findFirst().orElseThrow();
        assertThat(planned.getStartDate()).isEqualTo(activeEnd.plusDays(1));

        int seq = Integer.parseInt(created.get(0).seq().substring("MCP-".length()));
        Task task = tasks.findByProjectIdAndSeq(projectId(), seq).orElseThrow();
        assertThat(task.getSprintId()).isEqualTo(planned.getId());
        // 默认 assignee = PAT 用户
        assertThat(task.getAssigneeId()).isEqualTo(userId);
        // activity 标 MCP 来源
        List<Activity> acts = activities.findByTaskIdOrderByAtDescIdDesc(task.getId());
        assertThat(acts).isNotEmpty();
        assertThat(acts.get(acts.size() - 1).getSource()).isEqualTo(Activity.Source.MCP);
    }

    @Test
    void updateTaskStatusToDoneSetsDoneAt() {
        List<McpTools.CreatedTask> created = mcpTools.createTasks("MCP", "current_sprint", List.of(
                new McpTools.TaskInput(Task.Type.TASK, "finish me", null, 1, null)));
        String seqKey = created.get(0).seq();

        Map<String, Object> result = mcpTools.updateTaskStatus(seqKey, "DONE");
        assertThat(result.get("status")).isEqualTo("DONE");

        int seq = Integer.parseInt(seqKey.substring("MCP-".length()));
        Task task = tasks.findByProjectIdAndSeq(projectId(), seq).orElseThrow();
        assertThat(task.getStatus()).isEqualTo(Task.Status.DONE);
        assertThat(task.getDoneAt()).isNotNull();
    }

    @Test
    void readToolsReturnData() {
        assertThat(mcpTools.listProjects())
                .anySatisfy(pv -> assertThat(pv.key()).isEqualTo("MCP"));
        Map<String, Object> sprintsView = mcpTools.listSprints("MCP");
        assertThat(sprintsView.get("active")).isNotNull();
        mcpTools.createTasks("MCP", "current_sprint", List.of(
                new McpTools.TaskInput(Task.Type.BUG, "my bug", null, 2, null)));
        List<Map<String, Object>> mine = mcpTools.listMyTasks("MCP", "current");
        assertThat(mine).anySatisfy(t -> assertThat(t.get("title")).isEqualTo("my bug"));
    }

    private long projectId() {
        return projects.findByKey("MCP").orElseThrow().getId();
    }
}

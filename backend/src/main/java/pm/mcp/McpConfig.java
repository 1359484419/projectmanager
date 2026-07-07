package pm.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import pm.common.ApiException;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 内置 MCP Server（Streamable HTTP，端点 /mcp）。
 * - transport 是 SDK 自带的 HttpServlet 实现，注册为独立 Servlet（不经 DispatcherServlet）；
 * - 认证由 PatAuthFilter 完成（Spring Security 过滤链先于 Servlet 执行）；
 * - immediateExecution(true)：工具在请求线程同步执行，
 *   使 PatAuthFilter 设置的 SecurityContext / TenantContext（ThreadLocal）对工具可见。
 */
@Configuration
public class McpConfig {

    @Bean
    HttpServletStreamableServerTransportProvider mcpTransport(ObjectMapper objectMapper) {
        return HttpServletStreamableServerTransportProvider.builder()
                .jsonMapper(new JacksonMcpJsonMapper(objectMapper))
                .mcpEndpoint("/mcp")
                .build();
    }

    @Bean
    ServletRegistrationBean<HttpServletStreamableServerTransportProvider> mcpServlet(
            HttpServletStreamableServerTransportProvider transport) {
        ServletRegistrationBean<HttpServletStreamableServerTransportProvider> bean =
                new ServletRegistrationBean<>(transport, "/mcp");
        bean.setName("mcpServlet");
        bean.setAsyncSupported(true);
        bean.setLoadOnStartup(1);
        return bean;
    }

    @Bean
    McpSyncServer mcpServer(HttpServletStreamableServerTransportProvider transport,
                            McpTools tools, ObjectMapper objectMapper) {
        McpJsonMapper jsonMapper = new JacksonMcpJsonMapper(objectMapper);
        return McpServer.sync(transport)
                .serverInfo("projectmanager", "0.1.0")
                .capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
                .immediateExecution(true)
                .tools(toolSpecs(tools, objectMapper, jsonMapper))
                .build();
    }

    // ---------- 工具定义 ----------

    /** 包内可见：McpToolSchemaTest 直接校验工具 schema。 */
    List<McpServerFeatures.SyncToolSpecification> toolSpecs(
            McpTools tools, ObjectMapper om, McpJsonMapper jsonMapper) {
        return List.of(
                spec(jsonMapper, om, "list_projects",
                        "列出当前租户的所有项目（key 与名称）。",
                        """
                        {"type":"object","properties":{}}
                        """,
                        args -> tools.listProjects()),

                spec(jsonMapper, om, "list_sprints",
                        "列出项目的 Sprint：active（当前进行中）、next（下一个 PLANNED）与 recent（最近关闭的最多 5 个）。",
                        """
                        {"type":"object","properties":{
                          "projectKey":{"type":"string","description":"项目 key，如 PM"}
                        },"required":["projectKey"]}
                        """,
                        args -> tools.listSprints(str(args, "projectKey"))),

                spec(jsonMapper, om, "list_epics",
                        "列出项目的 Epic（id、名称、季度、状态），创建任务时可用 id 挂接。",
                        """
                        {"type":"object","properties":{
                          "projectKey":{"type":"string","description":"项目 key，如 PM"}
                        },"required":["projectKey"]}
                        """,
                        args -> tools.listEpics(str(args, "projectKey"))),

                spec(jsonMapper, om, "list_my_tasks",
                        "列出我（PAT 用户）在某个 Sprint 的任务与状态，供生成日报/周报。"
                                + "sprint 可选，默认 current（当前进行中 Sprint）；写周报回顾上一周期时传 previous（上一个已关闭 Sprint）。",
                        """
                        {"type":"object","properties":{
                          "projectKey":{"type":"string","description":"项目 key，如 PM"},
                          "sprint":{"type":"string","enum":["current","previous"],"description":"可选，默认 current=当前 Sprint；previous=上个已关闭 Sprint（周报用）"}
                        },"required":["projectKey"]}
                        """,
                        args -> tools.listMyTasks(str(args, "projectKey"), str(args, "sprint"))),

                spec(jsonMapper, om, "create_tasks",
                        "批量创建任务（单次最多 20 条）。重要：调用前必须先向用户展示将要创建的任务清单（标题/类型/points/挂载目标）并获得用户确认，未经确认不得调用。"
                                + "target=current_sprint 挂当前 Sprint、next_sprint 挂下个 Sprint（无 PLANNED 时按项目默认周期自动预建）、backlog 进待办。"
                                + "任务默认指派给 PAT 用户本人。",
                        """
                        {"type":"object","properties":{
                          "projectKey":{"type":"string","description":"项目 key，如 PM"},
                          "target":{"type":"string","enum":["current_sprint","next_sprint","backlog"]},
                          "tasks":{"type":"array","maxItems":20,"items":{"type":"object","properties":{
                            "type":{"type":"string","enum":["STORY","BUG","TASK"]},
                            "title":{"type":"string"},
                            "description":{"type":"string"},
                            "points":{"type":"number","minimum":0.5,"maximum":5,"multipleOf":0.5,"description":"故事点：0.5-5，0.5 的倍数（1 point = 1 人天）"},
                            "epicId":{"type":"integer"}
                          },"required":["type","title"]}}
                        },"required":["projectKey","target","tasks"]}
                        """,
                        args -> tools.createTasks(str(args, "projectKey"), str(args, "target"),
                                om.convertValue(args.get("tasks"),
                                        om.getTypeFactory().constructCollectionType(
                                                List.class, McpTools.TaskInput.class)))),

                spec(jsonMapper, om, "update_task_status",
                        "按展示号推进任务状态（四态：TODO → IN_PROGRESS → COMPLETED → DONE，允许回退）。",
                        """
                        {"type":"object","properties":{
                          "taskSeq":{"type":"string","description":"任务展示号，如 PM-42"},
                          "status":{"type":"string","enum":["TODO","IN_PROGRESS","COMPLETED","DONE"]}
                        },"required":["taskSeq","status"]}
                        """,
                        args -> tools.updateTaskStatus(str(args, "taskSeq"), str(args, "status"))));
    }

    /** 统一包装：结果序列化为 JSON 文本；ApiException 转 isError 结果，agent 可读。 */
    private McpServerFeatures.SyncToolSpecification spec(
            McpJsonMapper jsonMapper, ObjectMapper om, String name, String description,
            String inputSchema, Function<Map<String, Object>, Object> handler) {
        McpSchema.Tool tool = McpSchema.Tool.builder(name)
                .description(description)
                .inputSchema(jsonMapper, inputSchema)
                .build();
        return McpServerFeatures.SyncToolSpecification.builder()
                .tool(tool)
                .callHandler((exchange, request) -> {
                    try {
                        Object result = handler.apply(request.arguments() == null
                                ? Map.of() : request.arguments());
                        return McpSchema.CallToolResult.builder()
                                .addContent(new McpSchema.TextContent(toJson(om, result)))
                                .build();
                    } catch (ApiException e) {
                        return McpSchema.CallToolResult.builder()
                                .isError(true)
                                .addContent(new McpSchema.TextContent(
                                        "{\"code\":\"" + e.getCode() + "\",\"message\":\""
                                                + e.getMessage().replace("\"", "'") + "\"}"))
                                .build();
                    }
                })
                .build();
    }

    private static String toJson(ObjectMapper om, Object value) {
        try {
            return om.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("failed to serialize tool result", e);
        }
    }

    private static String str(Map<String, Object> args, String key) {
        Object v = args.get(key);
        return v == null ? null : String.valueOf(v);
    }
}

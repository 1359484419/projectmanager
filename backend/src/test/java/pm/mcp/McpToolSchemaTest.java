package pm.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * MCP 工具 schema 单测（不起 Spring）：list_my_tasks 的 sprint 参数可选、默认 current，
 * description 说明 previous 用于周报。
 */
class McpToolSchemaTest {

    private McpSchema.Tool tool(String name) {
        ObjectMapper om = new ObjectMapper();
        List<McpServerFeatures.SyncToolSpecification> specs =
                new McpConfig().toolSpecs(null, om, new JacksonMcpJsonMapper(om));
        return specs.stream()
                .map(McpServerFeatures.SyncToolSpecification::tool)
                .filter(t -> t.name().equals(name))
                .findFirst().orElseThrow();
    }

    @Test
    @SuppressWarnings("unchecked")
    void listMyTasks_sprintIsOptional_onlyProjectKeyRequired() {
        McpSchema.Tool t = tool("list_my_tasks");
        List<String> required = (List<String>) t.inputSchema().get("required");
        assertThat(required).containsExactly("projectKey");
    }

    @Test
    void listMyTasks_descriptionExplainsDefaultAndPreviousForWeekly() {
        McpSchema.Tool t = tool("list_my_tasks");
        assertThat(t.description()).contains("默认");
        assertThat(t.description()).contains("previous");
        assertThat(t.description()).contains("周报");
    }
}

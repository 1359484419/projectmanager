package pm.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 框架级异常不再 500（审查报告 P1）：坏 JSON / 缺参数 / 路径类型错 / 非法枚举 / 无请求体 → 400，
 * 方法不支持 → 405，内容类型不支持 → 415，统一 {code, message} 且 message 为中文。
 */
class FrameworkErrorTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    Object taskId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects", Map.of("key", "PM", "name", "demo"));
        taskId = fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", "t")).getBody().get("id");
    }

    private ResponseEntity<Map> raw(HttpMethod method, String path, String body, MediaType contentType) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(fx.adminTokenA);
        if (contentType != null) {
            headers.setContentType(contentType);
        }
        return rest.exchange(path, method, new HttpEntity<>(body, headers), Map.class);
    }

    private static void assertError(ResponseEntity<Map> resp, int status, String code) {
        assertThat(resp.getStatusCode().value()).as("body=%s", resp.getBody()).isEqualTo(status);
        assertThat(resp.getBody().get("code")).isEqualTo(code);
        String message = (String) resp.getBody().get("message");
        assertThat(message).isNotBlank();
        assertThat(message).as("message 应为中文").matches(".*[\\u4e00-\\u9fff].*");
        assertThat(message).doesNotContain("Exception");
    }

    @Test
    void malformedJson_400() {
        assertError(raw(HttpMethod.POST, base + "/projects/PM/tasks", "{bad json", MediaType.APPLICATION_JSON),
                400, "VALIDATION");
    }

    @Test
    void missingBody_400() {
        assertError(raw(HttpMethod.POST, base + "/tasks/" + taskId + "/comments", null, MediaType.APPLICATION_JSON),
                400, "VALIDATION");
    }

    @Test
    void invalidEnum_400() {
        assertError(raw(HttpMethod.PATCH, base + "/tasks/" + taskId, "{\"status\":\"FOO\"}",
                MediaType.APPLICATION_JSON), 400, "VALIDATION");
    }

    @Test
    void missingQueryParam_400() {
        assertError(raw(HttpMethod.GET, base + "/tasks/search", null, null), 400, "VALIDATION");
    }

    @Test
    void pathTypeMismatch_400() {
        assertError(raw(HttpMethod.GET, base + "/tasks/abc", null, null), 400, "VALIDATION");
    }

    @Test
    void methodNotSupported_405() {
        assertError(raw(HttpMethod.PUT, base + "/tasks/" + taskId, "{}", MediaType.APPLICATION_JSON),
                405, "METHOD_NOT_ALLOWED");
        assertError(raw(HttpMethod.GET, base + "/invites", null, null), 405, "METHOD_NOT_ALLOWED");
    }

    @Test
    void unsupportedMediaType_415() {
        assertError(raw(HttpMethod.POST, base + "/projects/PM/tasks", "type=TASK", MediaType.TEXT_PLAIN),
                415, "UNSUPPORTED_MEDIA_TYPE");
    }
}

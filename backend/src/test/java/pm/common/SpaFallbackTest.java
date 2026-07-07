package pm.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SPA fallback：非 /api、/mcp 的前端路由路径（无扩展名）未匹配静态资源时回 index.html；
 * API 路径不受影响；静态资源路径（带扩展名）不存在时返回 404。
 * 测试用 index.html 位于 src/test/resources/static/。
 */
class SpaFallbackTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Test
    void rootPath_servesIndexHtml_withoutAuth() {
        ResponseEntity<String> resp = rest.getForEntity("/", String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).contains("SPA_TEST_MARKER");
    }

    @Test
    void spaRoute_fallsBackToIndexHtml_withoutAuth() {
        ResponseEntity<String> resp = rest.getForEntity("/t/some-tenant/dashboard", String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).contains("SPA_TEST_MARKER");
    }

    @Test
    void loginRoute_fallsBackToIndexHtml() {
        ResponseEntity<String> resp = rest.getForEntity("/login", String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).contains("SPA_TEST_MARKER");
    }

    @Test
    void unknownApiPath_isNotSwallowedBySpaFallback() {
        ResponseEntity<String> resp = rest.getForEntity("/api/definitely-not-a-real-endpoint", String.class);
        assertThat(resp.getStatusCode().value()).isIn(401, 404);
        String body = resp.getBody();
        assertThat(body == null || !body.contains("SPA_TEST_MARKER")).isTrue();
    }

    @Test
    void missingStaticAsset_returns404_notIndexHtml() {
        ResponseEntity<String> resp = rest.getForEntity("/assets/no-such-file.js", String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }
}

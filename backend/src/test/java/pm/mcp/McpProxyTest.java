package pm.mcp;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
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
import pm.assistant.AssistantProperties;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * /mcp 反代（Java 只做 PAT 认证 + 注入 X-PM-*，MCP 协议由 Python 服务实现）：
 * - 无 PAT → 401 且响应体无堆栈；JWT 也不行（MCP 只认 PAT）
 * - PAT → 上游收到 X-PM-Tenant/X-PM-User/X-PM-Source=MCP 与原 Authorization；客户端伪造的 X-PM-* 被覆盖/丢弃
 * - 响应状态码、Content-Type、Mcp-Session-Id、响应体原样透传
 * - 上游不通 → 503 MCP_UNAVAILABLE；GET/DELETE → 405 JSON-RPC 风格错误体；请求体 >512KB → 413
 */
class McpProxyTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    AssistantProperties props;

    @Autowired
    ApiTokenRepository tokens;

    TwoTenantsFixture fx;
    String pat;
    long patUserId;
    HttpServer upstream;
    String originalUrl;

    final AtomicReference<com.sun.net.httpserver.Headers> seenHeaders = new AtomicReference<>();
    final AtomicReference<String> seenBody = new AtomicReference<>();
    final AtomicReference<String> seenPath = new AtomicReference<>();
    final AtomicReference<String> seenMethod = new AtomicReference<>();
    final AtomicInteger hits = new AtomicInteger();
    /** 模拟 Python 返回的状态码（可按用例改）。 */
    final AtomicInteger upstreamStatus = new AtomicInteger(200);

    static final String UPSTREAM_BODY =
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"list_projects\"}]}}";

    @BeforeEach
    void setUp() throws IOException {
        fx = new TwoTenantsFixture(rest);
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "mcp", "tenantSlug", fx.slugA));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        pat = (String) created.getBody().get("token");
        patUserId = tokens.findByTokenHash(ApiToken.sha256(pat)).orElseThrow().getUserId();

        originalUrl = props.getUrl();
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/", exchange -> {
            hits.incrementAndGet();
            seenHeaders.set(exchange.getRequestHeaders());
            seenPath.set(exchange.getRequestURI().toString());
            seenMethod.set(exchange.getRequestMethod());
            seenBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = UPSTREAM_BODY.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.getResponseHeaders().set("Mcp-Session-Id", "sess-123");
            exchange.sendResponseHeaders(upstreamStatus.get(), body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        upstream.start();
        props.setUrl("http://127.0.0.1:" + upstream.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        props.setUrl(originalUrl);
        upstream.stop(0);
    }

    private HttpHeaders mcpHeaders(String bearer) {
        HttpHeaders headers = new HttpHeaders();
        if (bearer != null) {
            headers.setBearerAuth(bearer);
        }
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Accept", "application/json, text/event-stream");
        return headers;
    }

    private ResponseEntity<String> post(String bearer, String path, String body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, mcpHeaders(bearer)), String.class);
    }

    static final String INITIALIZE =
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}";

    @Test
    void noPat_gets401_withoutStackTrace() {
        ResponseEntity<String> resp = post(null, "/mcp", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(401);
        assertThat(resp.getBody()).contains("UNAUTHENTICATED").doesNotContain("stackTrace");
        assertThat(hits.get()).isZero();
    }

    @Test
    void jwtInsteadOfPat_gets401_upstreamNotCalled() {
        // /mcp 只认 PAT：浏览器 JWT 虽是有效身份，但没有租户绑定，不得直通
        ResponseEntity<String> resp = post(fx.adminTokenA, "/mcp", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(401);
        assertThat(resp.getBody()).contains("UNAUTHENTICATED").doesNotContain("stackTrace");
        assertThat(hits.get()).isZero();
    }

    @Test
    void pat_forwardsToPython_withInjectedContextHeaders_andPassesResponseThrough() {
        HttpHeaders headers = mcpHeaders(pat);
        headers.set("Mcp-Protocol-Version", "2025-06-18");
        headers.set("Mcp-Session-Id", "client-sess");
        headers.set("Last-Event-ID", "42");
        // 客户端伪造的上下文头：一律被反代覆盖 / 丢弃
        headers.set("X-PM-Tenant", fx.slugB);
        headers.set("X-PM-User", "999999");
        headers.set("X-PM-Source", "WEB");
        headers.set("X-PM-Project", "FORGED");
        ResponseEntity<String> resp = rest.exchange("/mcp", HttpMethod.POST,
                new HttpEntity<>(INITIALIZE, headers), String.class);

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getHeaders().getContentType().toString()).startsWith("application/json");
        assertThat(resp.getHeaders().getFirst("Mcp-Session-Id")).isEqualTo("sess-123");
        assertThat(resp.getBody()).isEqualTo(UPSTREAM_BODY);

        assertThat(hits.get()).isEqualTo(1);
        assertThat(seenMethod.get()).isEqualTo("POST");
        assertThat(seenPath.get()).isEqualTo("/mcp/");
        assertThat(seenBody.get()).isEqualTo(INITIALIZE);
        var h = seenHeaders.get();
        assertThat(h.get("X-PM-Tenant")).containsExactly(fx.slugA);
        assertThat(h.get("X-PM-User")).containsExactly(Long.toString(patUserId));
        assertThat(h.get("X-PM-Source")).containsExactly("MCP");
        assertThat(h.containsKey("X-PM-Project")).as("客户端不得注入 X-PM-Project").isFalse();
        assertThat(h.getFirst("Authorization")).isEqualTo("Bearer " + pat);
        assertThat(h.getFirst("Mcp-Protocol-Version")).isEqualTo("2025-06-18");
        assertThat(h.getFirst("Mcp-Session-Id")).isEqualTo("client-sess");
        assertThat(h.getFirst("Last-Event-ID")).isEqualTo("42");
        assertThat(h.getFirst("Accept")).contains("text/event-stream");
        assertThat(h.getFirst("Content-Type")).startsWith("application/json");
        // 上游是 uvicorn（h11）：必须 HTTP/1.1，不得带 h2c 升级头
        assertThat(h.containsKey("Upgrade")).isFalse();
        assertThat(h.containsKey("HTTP2-Settings")).isFalse();
    }

    @Test
    void trailingSlash_alsoProxied() {
        ResponseEntity<String> resp = post(pat, "/mcp/", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(hits.get()).isEqualTo(1);
    }

    @Test
    void upstreamStatusCode_isPassedThrough() {
        upstreamStatus.set(404);
        ResponseEntity<String> resp = post(pat, "/mcp", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
        assertThat(resp.getBody()).isEqualTo(UPSTREAM_BODY);
    }

    @Test
    void upstreamDown_gets503McpUnavailable() throws IOException {
        int freePort;
        try (ServerSocket s = new ServerSocket(0)) {
            freePort = s.getLocalPort();
        }
        props.setUrl("http://127.0.0.1:" + freePort);
        ResponseEntity<String> resp = post(pat, "/mcp", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(503);
        assertThat(resp.getBody()).contains("MCP_UNAVAILABLE").doesNotContain("stackTrace");
    }

    @Test
    void urlNotConfigured_gets503McpUnavailable() {
        props.setUrl("");
        ResponseEntity<String> resp = post(pat, "/mcp", INITIALIZE);
        assertThat(resp.getStatusCode().value()).isEqualTo(503);
        assertThat(resp.getBody()).contains("MCP_UNAVAILABLE");
        assertThat(hits.get()).isZero();
    }

    @Test
    void getAndDelete_get405JsonRpcError_withoutStackTrace() {
        for (HttpMethod method : new HttpMethod[]{HttpMethod.GET, HttpMethod.DELETE}) {
            ResponseEntity<String> resp = rest.exchange("/mcp", method,
                    new HttpEntity<>(null, mcpHeaders(pat)), String.class);
            assertThat(resp.getStatusCode().value()).as(method.name()).isEqualTo(405);
            assertThat(resp.getHeaders().getContentType().toString()).startsWith("application/json");
            assertThat(resp.getBody()).as(method.name())
                    .contains("\"jsonrpc\":\"2.0\"").contains("\"error\"").contains("-32601")
                    .doesNotContain("stackTrace");
        }
        assertThat(hits.get()).isZero();
    }

    @Test
    void oversizedBody_gets413_andUpstreamNotCalled() {
        String huge = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"x\":\""
                + "x".repeat(512 * 1024 + 1) + "\"}}";
        ResponseEntity<String> resp = post(pat, "/mcp", huge);
        assertThat(resp.getStatusCode().value()).isEqualTo(413);
        assertThat(resp.getBody()).contains("PAYLOAD_TOO_LARGE");
        assertThat(hits.get()).isZero();
    }
}

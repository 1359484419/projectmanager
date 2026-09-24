package pm.assistant;

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
 * 助手反代 /api/t/{slug}/assistant/**：
 * - 透传 Authorization / 请求体，注入 X-PM-Tenant、X-PM-User，SSE 原样到达客户端
 * - 非成员访问 → 404（TenantInterceptor 在转发之前拦住）
 * - 未配置 pm.assistant.url → 404；上游端口不通 → 503 ASSISTANT_UNAVAILABLE
 */
class AssistantProxyTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    AssistantProperties props;

    TwoTenantsFixture fx;
    HttpServer upstream;
    String originalUrl;

    /** 上游收到的最近一次请求（header + body + 路径），供断言。 */
    final AtomicReference<com.sun.net.httpserver.Headers> seenHeaders = new AtomicReference<>();
    final AtomicReference<String> seenBody = new AtomicReference<>();
    final AtomicReference<String> seenPath = new AtomicReference<>();
    final AtomicInteger hits = new AtomicInteger();

    @BeforeEach
    void setUp() throws IOException {
        fx = new TwoTenantsFixture(rest);
        originalUrl = props.getUrl();
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/", exchange -> {
            hits.incrementAndGet();
            seenHeaders.set(exchange.getRequestHeaders());
            seenPath.set(exchange.getRequestURI().toString());
            seenBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] sse = "event: token\ndata: {\"text\":\"你好\"}\n\nevent: done\ndata: {}\n\n"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, sse.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(sse);
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

    private ResponseEntity<String> post(String token, String path, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
    }

    @Test
    void forwardsHeadersAndBody_andStreamsSseBack() {
        ResponseEntity<String> resp = post(fx.adminTokenA,
                "/api/t/" + fx.slugA + "/assistant/threads/t1/messages?project=PM&page=/t/x/board",
                Map.of("text", "把 PM-1 标记为完成"));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getHeaders().getContentType().toString()).startsWith("text/event-stream");
        assertThat(resp.getBody()).contains("event: token").contains("event: done").contains("你好");

        assertThat(hits.get()).isEqualTo(1);
        assertThat(seenPath.get()).isEqualTo("/assistant/threads/t1/messages?project=PM&page=/t/x/board");
        var h = seenHeaders.get();
        assertThat(h.getFirst("X-PM-Tenant")).isEqualTo(fx.slugA);
        assertThat(h.getFirst("X-PM-User")).matches("\\d+");
        assertThat(h.getFirst("X-PM-Project")).isEqualTo("PM");
        // 页面上下文与 project 同一载体：前端放查询参数 ?page=，反代映射成 X-PM-Page（Python 只读该头）
        assertThat(h.getFirst("X-PM-Page")).isEqualTo("/t/x/board");
        assertThat(h.getFirst("Authorization")).isEqualTo("Bearer " + fx.adminTokenA);
        assertThat(seenBody.get()).contains("PM-1");
        // 上游是 uvicorn（h11）：JDK HttpClient 默认 HTTP/2 会在明文 http 上带 h2c 升级头，
        // uvicorn 对不支持的 Upgrade 会丢掉请求体（FastAPI 422 "body missing"），必须钉死 HTTP/1.1
        assertThat(h.containsKey("Upgrade")).as("不得带 Upgrade: h2c").isFalse();
        assertThat(h.containsKey("HTTP2-Settings")).as("不得带 HTTP2-Settings").isFalse();
    }

    @Test
    void clientCannotInjectTenantOrUserHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(fx.adminTokenA);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-PM-Tenant", fx.slugB);
        headers.set("X-PM-User", "999999");
        headers.set("X-PM-Page", "/t/forged/board");
        headers.set("X-PM-Project", "FORGED");
        ResponseEntity<String> resp = rest.exchange("/api/t/" + fx.slugA + "/assistant/threads",
                HttpMethod.GET, new HttpEntity<>(headers), String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        var h = seenHeaders.get();
        assertThat(h.get("X-PM-Tenant")).containsExactly(fx.slugA);
        assertThat(h.get("X-PM-User")).hasSize(1);
        assertThat(h.getFirst("X-PM-User")).isNotEqualTo("999999");
        // 上下文头只由反代从查询参数注入，客户端自带的一律丢弃
        assertThat(h.containsKey("X-PM-Page")).as("客户端不得直接注入 X-PM-Page").isFalse();
        assertThat(h.containsKey("X-PM-Project")).as("客户端不得直接注入 X-PM-Project").isFalse();
    }

    @Test
    void oversizedBody_gets413_andUpstreamNotCalled() {
        String huge = "x".repeat(64 * 1024 + 1);
        ResponseEntity<String> resp = post(fx.adminTokenA,
                "/api/t/" + fx.slugA + "/assistant/threads/t1/messages", Map.of("text", huge));
        assertThat(resp.getStatusCode().value()).isEqualTo(413);
        assertThat(resp.getBody()).contains("PAYLOAD_TOO_LARGE");
        assertThat(hits.get()).isZero();
    }

    @Test
    void otherTenantMember_gets404_andUpstreamNotCalled() {
        ResponseEntity<String> resp = post(fx.adminTokenB,
                "/api/t/" + fx.slugA + "/assistant/threads", Map.of());
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
        assertThat(hits.get()).isZero();
    }

    @Test
    void unauthenticated_gets401() {
        ResponseEntity<String> resp = rest.postForEntity(
                "/api/t/" + fx.slugA + "/assistant/threads", Map.of(), String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(401);
        assertThat(hits.get()).isZero();
    }

    @Test
    void urlNotConfigured_gets404() {
        props.setUrl("");
        ResponseEntity<String> resp = post(fx.adminTokenA,
                "/api/t/" + fx.slugA + "/assistant/threads", Map.of());
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
        assertThat(hits.get()).isZero();
    }

    @Test
    void upstreamDown_gets503AssistantUnavailable() throws IOException {
        int freePort;
        try (ServerSocket s = new ServerSocket(0)) {
            freePort = s.getLocalPort();
        }
        props.setUrl("http://127.0.0.1:" + freePort);
        ResponseEntity<String> resp = post(fx.adminTokenA,
                "/api/t/" + fx.slugA + "/assistant/threads", Map.of());
        assertThat(resp.getStatusCode().value()).isEqualTo(503);
        assertThat(resp.getBody()).contains("ASSISTANT_UNAVAILABLE");
    }
}

package pm.mcp;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import pm.assistant.AssistantProperties;
import pm.common.ApiException;
import pm.tenant.TenantContext;
import pm.tenantadmin.Tenant;
import pm.tenantadmin.TenantRepository;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * MCP 反代（harness）：POST /mcp → {pm.assistant.url}/mcp/。MCP 协议本身由 Python 服务实现，
 * Java 只做三件事：PAT 认证、注入租户/用户上下文、直通转发。
 * <ul>
 *   <li>前置条件：PatAuthFilter 已认证（principal 为 userId 且 TenantContext 已由 PAT 设置），
 *       否则 401 UNAUTHENTICATED——浏览器 JWT 虽是有效身份但没有租户绑定，同样拒绝；</li>
 *   <li>透传 Authorization / Content-Type / Accept / Mcp-Protocol-Version / Mcp-Session-Id / Last-Event-ID，
 *       注入 X-PM-Tenant(slug)、X-PM-User(userId)、X-PM-Source: MCP；客户端自带的 X-PM-* 一律丢弃；</li>
 *   <li>响应透传状态码、Content-Type、Mcp-Session-Id；SSE 逐块 flush；</li>
 *   <li>请求体上限 {@link #MAX_BODY_BYTES}（413）；上游不可达/未配置 → 503 MCP_UNAVAILABLE；</li>
 *   <li>GET/DELETE（有状态会话流）不支持 → 405 JSON-RPC 风格错误体，永不带堆栈。</li>
 * </ul>
 * 与 AssistantProxyController 分开：那边按 /api/t/{slug} 路径解析租户、JWT 认证；这边租户只来自 PAT。
 */
@RestController
public class McpProxyController {

    private static final Logger log = LoggerFactory.getLogger(McpProxyController.class);

    /** 透传到上游的请求头白名单（其余全部丢弃，X-PM-* 只由反代注入）。 */
    static final List<String> PASS_REQUEST_HEADERS = List.of(
            "Authorization", "Content-Type", "Accept",
            "Mcp-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID");
    /** 透传回客户端的响应头。 */
    static final List<String> PASS_RESPONSE_HEADERS = List.of("Content-Type", "Mcp-Session-Id");
    /** 请求体上限：单次 tools/call 批量建 20 条任务也远小于此，超过视为滥用。 */
    static final int MAX_BODY_BYTES = 512 * 1024;
    private static final String BEARER_PAT = "Bearer " + ApiToken.PREFIX;

    private final AssistantProperties props;
    private final TenantRepository tenants;
    private final HttpClient client;

    public McpProxyController(AssistantProperties props, TenantRepository tenants) {
        this.props = props;
        this.tenants = tenants;
        // 上游 uvicorn 只讲 HTTP/1.1：JDK 默认 HTTP/2 会在明文连接上发 h2c 升级头，uvicorn 会丢掉请求体
        this.client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    @RequestMapping(value = {"/mcp", "/mcp/"}, method = RequestMethod.POST)
    public void proxy(HttpServletRequest request, HttpServletResponse response) throws IOException {
        long userId = requirePatUser(request);
        long tenantId = TenantContext.require();
        String slug = tenants.findById(tenantId).map(Tenant::getSlug)
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "not authenticated"));
        if (!props.isConfigured()) {
            throw unavailable();
        }
        URI target = URI.create(props.getUrl() + "/mcp/");

        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "request body too large");
        }
        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "request body too large");
        }

        HttpRequest.Builder builder = HttpRequest.newBuilder(target)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .timeout(Duration.ofMinutes(5));
        for (String name : PASS_REQUEST_HEADERS) {
            String value = request.getHeader(name);
            if (value != null) {
                builder.header(name, value);
            }
        }
        builder.header("X-PM-Tenant", slug);
        builder.header("X-PM-User", Long.toString(userId));
        builder.header("X-PM-Source", "MCP");

        HttpResponse<InputStream> upstream;
        try {
            upstream = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            log.warn("MCP 上游不可达 {}: {}", target, e.toString());
            throw unavailable();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        }

        response.setStatus(upstream.statusCode());
        for (String name : PASS_RESPONSE_HEADERS) {
            upstream.headers().firstValue(name).ifPresent(v -> response.setHeader(name, v));
        }
        String contentType = upstream.headers().firstValue("Content-Type").orElse("");
        boolean sse = contentType.startsWith("text/event-stream");
        if (sse) {
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("X-Accel-Buffering", "no");
        }
        try (InputStream in = upstream.body(); OutputStream out = response.getOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (sse) {
                    out.flush();
                }
            }
            out.flush();
        } catch (IOException e) {
            // 响应头已发出，无法再改状态码：客户端断开或上游中途断流，只记日志
            log.info("MCP 响应流中断 {}: {}", target, e.toString());
        }
    }

    /**
     * Streamable HTTP 的 GET（服务端推送流）与 DELETE（结束会话）依赖有状态会话，本服务无状态，
     * 按 MCP 规范回 405；错误体用 JSON-RPC 形状让客户端可识别，且永不带堆栈。
     */
    @RequestMapping(value = {"/mcp", "/mcp/"},
            method = {RequestMethod.GET, RequestMethod.DELETE, RequestMethod.PUT, RequestMethod.PATCH})
    public void methodNotAllowed(HttpServletRequest request, HttpServletResponse response) throws IOException {
        requirePatUser(request);
        response.setStatus(HttpStatus.METHOD_NOT_ALLOWED.value());
        response.setHeader("Allow", "POST");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        String body = "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32601,"
                + "\"message\":\"Method not allowed: /mcp only accepts POST (stateless Streamable HTTP)\"}}";
        response.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }

    /** 只认 PAT：Authorization 是 pmt_ 令牌、principal 为 userId、且 PatAuthFilter 已设置租户上下文。 */
    private static long requirePatUser(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (authorization != null && authorization.startsWith(BEARER_PAT)
                && auth != null && auth.getPrincipal() instanceof Long userId
                && TenantContext.isSet()) {
            return userId;
        }
        throw ApiException.unauthorized("UNAUTHENTICATED", "personal access token required");
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MCP_UNAVAILABLE", "mcp service unavailable");
    }
}

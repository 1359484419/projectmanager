package pm.assistant;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.common.ApiException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

/**
 * 助手反代（第一道 harness）：/api/t/{slug}/assistant/** → {pm.assistant.url}/assistant/**。
 * 走到这里说明 JWT 有效且是该租户成员（Security + TenantInterceptor 已校验），
 * 于是把校验结果以 header 注入给 Python：X-PM-Tenant=slug、X-PM-User=userId；页面上下文同样只由反代从查询参数映射：
 * ?project= → X-PM-Project、?page= → X-PM-Page。客户端自带的这四个 header 一律丢弃。Authorization 与请求体原样透传。
 * 请求体上限 64KB（超过 413，不转发；消息文本的字符上限在 Python 侧再校验）。
 * SSE 响应逐块写回并 flush（同步转发，不走 MVC async dispatch，避免 interceptor 重跑）。
 * 上游不可达 → 503 ASSISTANT_UNAVAILABLE；未配置 url → 404。
 */
@RestController
@RequestMapping("/api/t/{slug}/assistant")
public class AssistantProxyController {

    private static final Logger log = LoggerFactory.getLogger(AssistantProxyController.class);

    /** 透传到上游的请求头（其余全部丢弃；X-PM-* 上下文头只由反代注入）。 */
    private static final List<String> PASS_REQUEST_HEADERS =
            List.of("Authorization", "Content-Type", "Accept", "Accept-Language");
    /** 请求体上限：助手只收一句话或几条决策，超过视为滥用。 */
    static final int MAX_BODY_BYTES = 64 * 1024;
    /** 透传回客户端的响应头。 */
    private static final List<String> PASS_RESPONSE_HEADERS = List.of("Content-Type");

    private final AssistantProperties props;
    private final HttpClient client;

    public AssistantProxyController(AssistantProperties props) {
        this.props = props;
        // 上游 uvicorn 只讲 HTTP/1.1：JDK 默认 HTTP/2 会在明文连接上发 h2c 升级头，uvicorn 会丢掉请求体
        this.client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    @RequestMapping(value = "/**", method = {RequestMethod.GET, RequestMethod.POST,
            RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
    public void proxy(@PathVariable String slug, HttpServletRequest request,
                      HttpServletResponse response) throws IOException {
        if (!props.isConfigured()) {
            throw ApiException.notFound();
        }
        long userId = CurrentUser.id();
        String prefix = "/api/t/" + slug + "/assistant";
        String rest = request.getRequestURI().substring(prefix.length());
        String query = request.getQueryString();
        URI target = URI.create(props.getUrl() + "/assistant" + rest + (query == null ? "" : "?" + query));

        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "request body too large");
        }
        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "request body too large");
        }
        HttpRequest.Builder builder = HttpRequest.newBuilder(target)
                .method(request.getMethod(), body.length == 0
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofByteArray(body))
                .timeout(Duration.ofMinutes(5));
        for (String name : PASS_REQUEST_HEADERS) {
            String value = request.getHeader(name);
            if (value != null) {
                builder.header(name, value);
            }
        }
        builder.header("X-PM-Tenant", slug);
        builder.header("X-PM-User", Long.toString(userId));
        String project = request.getParameter("project");
        if (project != null && !project.isBlank()) {
            builder.header("X-PM-Project", project);
        }
        String page = request.getParameter("page");
        if (page != null && !page.isBlank()) {
            builder.header("X-PM-Page", page);
        }

        HttpResponse<InputStream> upstream;
        try {
            upstream = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            log.warn("助手服务不可达 {}: {}", target, e.toString());
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_UNAVAILABLE",
                    "assistant service unavailable");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_UNAVAILABLE",
                    "assistant service unavailable");
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
            log.info("助手响应流中断 {}: {}", target, e.toString());
        }
    }
}

package pm.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import pm.mcp.ApiToken;
import pm.task.Activity;

/**
 * 当前请求的活动来源判定（harness：业务代码不读 header，只调这里）。
 * <ul>
 *   <li>Authorization 为 PAT（pmt_ 前缀）→ MCP，无论请求带什么 X-PM-Source（防伪造，Review Focus 5）</li>
 *   <li>JWT 已认证且 X-PM-Source 恰为 AGENT → AGENT（助手回调）</li>
 *   <li>其余（含无请求上下文的定时任务）→ WEB</li>
 * </ul>
 */
public final class RequestSource {

    public static final String HEADER = "X-PM-Source";
    private static final String BEARER_PAT = "Bearer " + ApiToken.PREFIX;

    private RequestSource() {
    }

    public static Activity.Source current() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs)) {
            return Activity.Source.WEB;
        }
        HttpServletRequest request = attrs.getRequest();
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith(BEARER_PAT)) {
            return Activity.Source.MCP;
        }
        if (!"AGENT".equals(request.getHeader(HEADER))) {
            return Activity.Source.WEB;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        boolean jwtUser = auth != null && auth.getPrincipal() instanceof Long;
        return jwtUser ? Activity.Source.AGENT : Activity.Source.WEB;
    }
}

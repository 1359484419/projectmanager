package pm.tenant;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 最小租户内端点：验证 harness（interceptor + 404 语义）。
 */
@RestController
public class TenantPingController {

    @GetMapping("/api/t/{slug}/ping")
    Map<String, Object> ping(@PathVariable String slug) {
        return Map.of("tenantId", TenantContext.require());
    }
}

package pm.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import pm.tenant.TenantInterceptor;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final TenantInterceptor tenantInterceptor;

    public WebConfig(TenantInterceptor tenantInterceptor) {
        this.tenantInterceptor = tenantInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 必须排在 OSIV（OpenEntityManagerInViewInterceptor，order=0）之后，
        // 否则 preHandle 时请求级 EntityManager 尚未绑定，tenantFilter 会开在临时 session 上而失效。
        registry.addInterceptor(tenantInterceptor)
                .addPathPatterns("/api/t/**")
                .order(Ordered.LOWEST_PRECEDENCE);
    }
}

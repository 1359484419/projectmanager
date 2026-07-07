package pm.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;
import pm.tenant.TenantInterceptor;

import java.io.IOException;

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

    /**
     * SPA fallback：静态资源存在则原样返回；不存在时——
     * - /api、/mcp 路径不 fallback（交给 Security/404）；
     * - 带扩展名的资源路径（如 /assets/x.js）返回 404，避免 JS/CSS 加载错拿到 HTML；
     * - 其余视为前端路由（/login、/t/{slug}/board 等），回 index.html。
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) {
                            return requested;
                        }
                        if (resourcePath.startsWith("api/") || resourcePath.startsWith("mcp")) {
                            return null;
                        }
                        String lastSegment = resourcePath.substring(resourcePath.lastIndexOf('/') + 1);
                        if (lastSegment.contains(".")) {
                            return null;
                        }
                        Resource index = location.createRelative("index.html");
                        return index.exists() && index.isReadable() ? index : null;
                    }
                });
    }
}

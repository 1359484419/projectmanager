package pm.assistant;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 助手（Python 智能体服务）配置：pm.assistant.url（env PM_ASSISTANT_URL）。
 * 为空表示未部署助手，反代路由返回 404，主应用不受影响。
 */
@Component
@ConfigurationProperties(prefix = "pm.assistant")
public class AssistantProperties {

    /** 上游地址，如 http://127.0.0.1:8090；不含 /assistant 前缀。 */
    private String url = "";

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url == null ? "" : url.trim();
    }

    public boolean isConfigured() {
        return !url.isEmpty();
    }
}

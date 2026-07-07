package pm;

import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 双租户测试夹具：租户 A（admin a）与租户 B（admin b），
 * 供跨租户 404 隔离测试与 ADMIN/MEMBER 权限测试复用。
 */
public class TwoTenantsFixture {

    public final String slugA;
    public final String slugB;
    public final String adminTokenA;
    public final String adminTokenB;

    private final TestRestTemplate rest;

    public TwoTenantsFixture(TestRestTemplate rest) {
        this.rest = rest;
        this.slugA = "ta-" + UUID.randomUUID().toString().substring(0, 8);
        this.slugB = "tb-" + UUID.randomUUID().toString().substring(0, 8);
        this.adminTokenA = register(slugA);
        this.adminTokenB = register(slugB);
    }

    @SuppressWarnings("unchecked")
    private String register(String slug) {
        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> resp = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U" + u, "tenantName", "T" + u, "tenantSlug", slug), Map.class);
        assertThat(resp.getStatusCode().value()).as("register %s", slug).isEqualTo(200);
        return (String) resp.getBody().get("accessToken");
    }

    /** 通过邀请流程给租户 A 加一个 MEMBER，返回其 accessToken。 */
    @SuppressWarnings("unchecked")
    public String addMemberToA() {
        ResponseEntity<Map> invite = exchange(adminTokenA, HttpMethod.POST,
                "/api/t/" + slugA + "/invites", Map.of("role", "MEMBER"));
        assertThat(invite.getStatusCode().value()).isEqualTo(200);
        String token = (String) invite.getBody().get("token");
        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> accept = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u + "@example.com",
                "password", "secret123", "displayName", "M" + u), Map.class);
        assertThat(accept.getStatusCode().value()).isEqualTo(200);
        return (String) accept.getBody().get("accessToken");
    }

    /** 带 Bearer token 的 JSON 请求。body 可为 null。 */
    public ResponseEntity<Map> exchange(String token, HttpMethod method, String path, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(path, method, new HttpEntity<>(body, headers), Map.class);
    }

    /** GET 列表响应（反序列化为 List）。 */
    public ResponseEntity<java.util.List> getList(String token, String path) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), java.util.List.class);
    }
}

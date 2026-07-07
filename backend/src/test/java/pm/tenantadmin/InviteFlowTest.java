package pm.tenantadmin;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import pm.IntegrationTest;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 邀请链接流程：ADMIN 建邀请 → 新用户 accept 加入为 MEMBER；
 * 过期 token → 410 INVITE_EXPIRED；MEMBER 建邀请 → 404（管理资源对非 ADMIN 不存在）。
 */
class InviteFlowTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    JdbcTemplate jdbc;

    String slug;
    String adminToken;

    @SuppressWarnings("unchecked")
    private Map<String, Object> register(String slug) {
        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> resp = rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "U" + u, "tenantName", "T" + u, "tenantSlug", slug), Map.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private HttpHeaders bearer(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map> createInvite(String token, String role) {
        return rest.exchange("/api/t/" + slug + "/invites", HttpMethod.POST,
                new HttpEntity<>(Map.of("role", role), bearer(token)), Map.class);
    }

    @BeforeEach
    void setUp() {
        slug = "inv-" + UUID.randomUUID().toString().substring(0, 8);
        adminToken = (String) register(slug).get("accessToken");
    }

    @Test
    @SuppressWarnings("unchecked")
    void adminInvite_newUserAccept_becomesMember() {
        ResponseEntity<Map> invite = createInvite(adminToken, "MEMBER");
        assertThat(invite.getStatusCode().value()).isEqualTo(200);
        String token = (String) invite.getBody().get("token");
        assertThat(token).isNotBlank();
        assertThat((String) invite.getBody().get("url")).contains(token);
        assertThat((String) invite.getBody().get("expiresAt")).isNotBlank();

        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> accept = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u + "@example.com",
                "password", "secret123", "displayName", "New " + u), Map.class);
        assertThat(accept.getStatusCode().value()).isEqualTo(200);
        String newAccess = (String) accept.getBody().get("accessToken");
        assertThat(newAccess).isNotBlank();

        ResponseEntity<List> tenants = rest.exchange("/api/me/tenants", HttpMethod.GET,
                new HttpEntity<>(bearer(newAccess)), List.class);
        Map<String, Object> t = (Map<String, Object>) tenants.getBody().stream()
                .filter(x -> slug.equals(((Map<String, Object>) x).get("slug"))).findFirst().orElseThrow();
        assertThat(t.get("role")).isEqualTo("MEMBER");
    }

    @Test
    @SuppressWarnings("unchecked")
    void usedToken_secondAccept_410InviteUsed() {
        String token = (String) createInvite(adminToken, "MEMBER").getBody().get("token");
        String u1 = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> first = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u1 + "@example.com",
                "password", "secret123", "displayName", "First"), Map.class);
        assertThat(first.getStatusCode().value()).isEqualTo(200);

        // 同一 token 第二个人复用 → 410 INVITE_USED（一次性消费）
        String u2 = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> second = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u2 + "@example.com",
                "password", "secret123", "displayName", "Second"), Map.class);
        assertThat(second.getStatusCode().value()).isEqualTo(410);
        assertThat(second.getBody().get("code")).isEqualTo("INVITE_USED");
    }

    @Test
    @SuppressWarnings("unchecked")
    void kickedMember_cannotRejoinWithOldToken() {
        // carol 经邀请加入
        String token = (String) createInvite(adminToken, "MEMBER").getBody().get("token");
        String u = UUID.randomUUID().toString().substring(0, 8);
        String email = u + "@example.com";
        ResponseEntity<Map> accept = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", email,
                "password", "secret123", "displayName", "Carol"), Map.class);
        assertThat(accept.getStatusCode().value()).isEqualTo(200);
        String carolToken = (String) accept.getBody().get("accessToken");

        // admin 踢掉 carol
        List<Map> members = (List<Map>) rest.exchange("/api/t/" + slug + "/members",
                HttpMethod.GET, new HttpEntity<>(bearer(adminToken)), List.class).getBody();
        long carolId = members.stream()
                .filter(m -> email.equals(m.get("email")))
                .map(m -> ((Number) m.get("userId")).longValue())
                .findFirst().orElseThrow();
        ResponseEntity<Map> removed = rest.exchange("/api/t/" + slug + "/members/" + carolId,
                HttpMethod.DELETE, new HttpEntity<>(bearer(adminToken)), Map.class);
        assertThat(removed.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> denied = rest.exchange("/api/t/" + slug + "/members",
                HttpMethod.GET, new HttpEntity<>(bearer(carolToken)), Map.class);
        assertThat(denied.getStatusCode().value()).isEqualTo(404);

        // carol 用手里的旧邀请链接自助重新加入 → 必须被拒（token 已消费）
        ResponseEntity<Map> rejoin = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", email,
                "password", "secret123", "displayName", "Carol"), Map.class);
        assertThat(rejoin.getStatusCode().value()).isEqualTo(410);
        assertThat(rejoin.getBody().get("code")).isEqualTo("INVITE_USED");
        // membership 未恢复
        ResponseEntity<Map> stillDenied = rest.exchange("/api/t/" + slug + "/members",
                HttpMethod.GET, new HttpEntity<>(bearer(carolToken)), Map.class);
        assertThat(stillDenied.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @SuppressWarnings("unchecked")
    void expiredToken_410InviteExpired() {
        ResponseEntity<Map> invite = createInvite(adminToken, "MEMBER");
        String token = (String) invite.getBody().get("token");
        jdbc.update("UPDATE invites SET expires_at = now() - interval '1 day' WHERE token = ?", token);

        ResponseEntity<Map> accept = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", "x@example.com",
                "password", "secret123", "displayName", "X"), Map.class);
        assertThat(accept.getStatusCode().value()).isEqualTo(410);
        assertThat(accept.getBody().get("code")).isEqualTo("INVITE_EXPIRED");
    }

    @Test
    @SuppressWarnings("unchecked")
    void memberCreatesInvite_404() {
        // 先用 ADMIN 邀请一个 MEMBER 进来
        String token = (String) createInvite(adminToken, "MEMBER").getBody().get("token");
        String u = UUID.randomUUID().toString().substring(0, 8);
        ResponseEntity<Map> accept = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u + "@example.com",
                "password", "secret123", "displayName", "M"), Map.class);
        String memberToken = (String) accept.getBody().get("accessToken");

        ResponseEntity<Map> resp = createInvite(memberToken, "MEMBER");
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @SuppressWarnings("unchecked")
    void existingUserAccept_correctPassword_joins_wrongPassword_401() {
        // 已有用户（另一个租户的 owner）
        String otherSlug = "oth-" + UUID.randomUUID().toString().substring(0, 8);
        String u = UUID.randomUUID().toString().substring(0, 8);
        rest.postForEntity("/api/auth/register", Map.of(
                "email", u + "@example.com", "password", "secret123",
                "displayName", "E", "tenantName", "O", "tenantSlug", otherSlug), Map.class);

        String token1 = (String) createInvite(adminToken, "MEMBER").getBody().get("token");
        ResponseEntity<Map> bad = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token1, "email", u + "@example.com",
                "password", "wrong", "displayName", "E"), Map.class);
        assertThat(bad.getStatusCode().value()).isEqualTo(401);

        ResponseEntity<Map> ok = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token1, "email", u + "@example.com",
                "password", "secret123", "displayName", "E"), Map.class);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);

        String access = (String) ok.getBody().get("accessToken");
        ResponseEntity<List> tenants = rest.exchange("/api/me/tenants", HttpMethod.GET,
                new HttpEntity<>(bearer(access)), List.class);
        assertThat(tenants.getBody().stream()
                .map(x -> ((Map<String, Object>) x).get("slug")))
                .contains(slug, otherSlug);
    }
}

package pm.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 注册/接受邀请的入参校验（审查报告 P1）：邮箱格式、密码 ≥8 位、slug 规则；
 * 邮箱统一小写归一化后存储与查找（大小写不同不再是两个账号）。
 */
class RegistrationValidationTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    private Map<String, String> validRegister() {
        String u = UUID.randomUUID().toString().substring(0, 8);
        Map<String, String> body = new HashMap<>();
        body.put("email", u + "@example.com");
        body.put("password", "secret123");
        body.put("displayName", "U" + u);
        body.put("tenantName", "T" + u);
        body.put("tenantSlug", "rv-" + u);
        return body;
    }

    private ResponseEntity<Map> register(Map<String, String> body) {
        return rest.postForEntity("/api/auth/register", body, Map.class);
    }

    private static void assertValidation(ResponseEntity<Map> resp) {
        assertThat(resp.getStatusCode().value()).as("body=%s", resp.getBody()).isEqualTo(400);
        assertThat(resp.getBody().get("code")).isEqualTo("VALIDATION");
        assertThat((String) resp.getBody().get("message")).matches(".*[\\u4e00-\\u9fff].*");
    }

    @Test
    void register_rejectsBadEmail_shortPassword_badSlug() {
        Map<String, String> badEmail = validRegister();
        badEmail.put("email", "not-an-email");
        assertValidation(register(badEmail));

        Map<String, String> shortPwd = validRegister();
        shortPwd.put("password", "1234567");
        assertValidation(register(shortPwd));

        Map<String, String> badSlug = validRegister();
        badSlug.put("tenantSlug", "Bad_Slug");
        assertValidation(register(badSlug));

        assertThat(register(validRegister()).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void email_isNormalizedToLowerCase_forStorageLoginAndUniqueness() {
        String u = UUID.randomUUID().toString().substring(0, 8);
        Map<String, String> body = validRegister();
        body.put("email", "Mixed-" + u + "@Example.COM");
        assertThat(register(body).getStatusCode().value()).isEqualTo(200);

        // 小写登录成功
        ResponseEntity<Map> login = rest.postForEntity("/api/auth/login",
                Map.of("email", "mixed-" + u + "@example.com", "password", "secret123"), Map.class);
        assertThat(login.getStatusCode().value()).isEqualTo(200);
        // 大写登录同样成功（查找也归一化）
        ResponseEntity<Map> loginUpper = rest.postForEntity("/api/auth/login",
                Map.of("email", "MIXED-" + u + "@EXAMPLE.COM", "password", "secret123"), Map.class);
        assertThat(loginUpper.getStatusCode().value()).isEqualTo(200);

        // 换个大小写再注册 → 409 EMAIL_TAKEN
        Map<String, String> again = validRegister();
        again.put("email", "MIXED-" + u + "@example.com");
        ResponseEntity<Map> dup = register(again);
        assertThat(dup.getStatusCode().value()).isEqualTo(409);
        assertThat(dup.getBody().get("code")).isEqualTo("EMAIL_TAKEN");
    }

    @Test
    void acceptInvite_validatesAndNormalizes() {
        TwoTenantsFixture fx = new TwoTenantsFixture(rest);
        ResponseEntity<Map> invite = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                "/api/t/" + fx.slugA + "/invites", Map.of("role", "MEMBER"));
        String token = (String) invite.getBody().get("token");

        ResponseEntity<Map> shortPwd = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", "x@example.com", "password", "1234567", "displayName", "X"), Map.class);
        assertValidation(shortPwd);
        ResponseEntity<Map> badEmail = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", "nope", "password", "secret123", "displayName", "X"), Map.class);
        assertValidation(badEmail);

        // 老用户换大小写接受邀请：按已有账号处理（密码错 → 401，而不是新建账号）
        String u = UUID.randomUUID().toString().substring(0, 8);
        Map<String, String> existing = validRegister();
        existing.put("email", u + "@example.com");
        assertThat(register(existing).getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> wrongPwd = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u.toUpperCase() + "@EXAMPLE.com", "password", "wrongpass1",
                "displayName", "X"), Map.class);
        assertThat(wrongPwd.getStatusCode().value()).isEqualTo(401);
        assertThat(wrongPwd.getBody().get("code")).isEqualTo("BAD_CREDENTIALS");
        ResponseEntity<Map> ok = rest.postForEntity("/api/auth/accept-invite", Map.of(
                "token", token, "email", u.toUpperCase() + "@EXAMPLE.com", "password", "secret123",
                "displayName", "X"), Map.class);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
    }
}

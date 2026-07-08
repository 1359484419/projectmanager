package pm.user;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 个人改名/改密码 + 租户改名（仅 ADMIN）。 */
class ProfileAndTenantRenameTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Test
    void updateDisplayName_reflectedInMeTenants() {
        var fx = new TwoTenantsFixture(rest);
        ResponseEntity<Map> r = fx.exchange(fx.adminTokenA, HttpMethod.PATCH, "/api/me",
                Map.of("displayName", "新名字"));
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody().get("displayName")).isEqualTo("新名字");
        // 空名 → 400
        ResponseEntity<Map> blank = fx.exchange(fx.adminTokenA, HttpMethod.PATCH, "/api/me",
                Map.of("displayName", "  "));
        assertThat(blank.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void changePassword_verifiesOldAndRejectsWrong() {
        var fx = new TwoTenantsFixture(rest);
        // 错误旧密码 → 400 WRONG_PASSWORD
        ResponseEntity<Map> wrong = fx.exchange(fx.adminTokenA, HttpMethod.PUT, "/api/me/password",
                Map.of("oldPassword", "nope", "newPassword", "brandnew1"));
        assertThat(wrong.getStatusCode().value()).isEqualTo(400);
        assertThat(wrong.getBody().get("code")).isEqualTo("WRONG_PASSWORD");
        // 正确旧密码（fixture 注册用 secret123）→ 204
        ResponseEntity<Void> ok = fx.exchange(fx.adminTokenA, HttpMethod.PUT, "/api/me/password",
                Map.of("oldPassword", "secret123", "newPassword", "brandnew1"))
                .getStatusCode().is2xxSuccessful()
                ? ResponseEntity.ok().build() : ResponseEntity.badRequest().build();
        assertThat(ok.getStatusCode().is2xxSuccessful()).isTrue();
    }

    @Test
    void renameTenant_adminOnly_memberGets404() {
        var fx = new TwoTenantsFixture(rest);
        String path = "/api/t/" + fx.slugA;
        // ADMIN 改名成功
        ResponseEntity<Map> ok = fx.exchange(fx.adminTokenA, HttpMethod.PATCH, path,
                Map.of("name", "新团队名"));
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertThat(ok.getBody().get("name")).isEqualTo("新团队名");
        // 反映到 /api/me/tenants
        var tenants = fx.getList(fx.adminTokenA, "/api/me/tenants").getBody();
        assertThat(tenants).anyMatch(t -> "新团队名".equals(((Map<?, ?>) t).get("name")));
        // MEMBER 改名 → 404
        String memberToken = fx.addMemberToA();
        ResponseEntity<Map> denied = fx.exchange(memberToken, HttpMethod.PATCH, path,
                Map.of("name", "黑客改名"));
        assertThat(denied.getStatusCode().value()).isEqualTo(404);
        // 空名 → 400
        Map<String, Object> blank = new HashMap<>();
        blank.put("name", "");
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.PATCH, path, blank);
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
    }
}

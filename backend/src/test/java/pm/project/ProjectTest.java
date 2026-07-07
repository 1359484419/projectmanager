package pm.project;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 项目 CRUD：建项目默认值、key 唯一（租户内）、跨租户 404、PATCH 仅 ADMIN。
 */
class ProjectTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
    }

    private ResponseEntity<Map> createProject(String token, String slug, String key, String name) {
        return fx.exchange(token, HttpMethod.POST, "/api/t/" + slug + "/projects",
                Map.of("key", key, "name", name));
    }

    @Test
    void createProject_defaults() {
        ResponseEntity<Map> resp = createProject(fx.adminTokenA, fx.slugA, "PM", "项目管理");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        Map body = resp.getBody();
        assertThat(body.get("id")).isNotNull();
        assertThat(body.get("key")).isEqualTo("PM");
        assertThat(body.get("name")).isEqualTo("项目管理");
        assertThat(body.get("defaultSprintLength")).isEqualTo("WEEK_2");
        assertThat(body.get("autoRotate")).isEqualTo(true);
    }

    @Test
    void duplicateKey_409_butOtherTenantCanReuse() {
        assertThat(createProject(fx.adminTokenA, fx.slugA, "PM", "p1").getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> dup = createProject(fx.adminTokenA, fx.slugA, "PM", "p2");
        assertThat(dup.getStatusCode().value()).isEqualTo(409);
        assertThat(dup.getBody().get("code")).isEqualTo("KEY_TAKEN");
        // 另一租户可用同 key
        assertThat(createProject(fx.adminTokenB, fx.slugB, "PM", "p3").getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void invalidKey_400() {
        assertThat(createProject(fx.adminTokenA, fx.slugA, "p", "bad").getStatusCode().value()).isEqualTo(400);
        assertThat(createProject(fx.adminTokenA, fx.slugA, "TOOLONGX", "bad").getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void listProjects_onlyOwnTenant_crossTenant404() {
        createProject(fx.adminTokenA, fx.slugA, "AA", "a");
        ResponseEntity<List> list = fx.getList(fx.adminTokenA, "/api/t/" + fx.slugA + "/projects");
        assertThat(list.getStatusCode().value()).isEqualTo(200);
        assertThat(list.getBody()).hasSize(1);
        // b 的 token 打 A 的路径 → 404
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugA + "/projects", null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
        // b 自己租户看不到 A 的项目
        ResponseEntity<List> listB = fx.getList(fx.adminTokenB, "/api/t/" + fx.slugB + "/projects");
        assertThat(listB.getBody()).isEmpty();
    }

    @Test
    void patchProject_adminOnly() {
        createProject(fx.adminTokenA, fx.slugA, "PM", "old");
        ResponseEntity<Map> patched = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                "/api/t/" + fx.slugA + "/projects/PM",
                Map.of("name", "new", "defaultSprintLength", "WEEK_1", "autoRotate", false));
        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        assertThat(patched.getBody().get("name")).isEqualTo("new");
        assertThat(patched.getBody().get("defaultSprintLength")).isEqualTo("WEEK_1");
        assertThat(patched.getBody().get("autoRotate")).isEqualTo(false);
        // MEMBER 改项目设置 → 404（管理资源不暴露）
        String memberToken = fx.addMemberToA();
        ResponseEntity<Map> denied = fx.exchange(memberToken, HttpMethod.PATCH,
                "/api/t/" + fx.slugA + "/projects/PM", Map.of("name", "hack"));
        assertThat(denied.getStatusCode().value()).isEqualTo(404);
    }
}

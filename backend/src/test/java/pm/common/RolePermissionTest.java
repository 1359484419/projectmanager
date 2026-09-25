package pm.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 权限矩阵 harness（审查报告 P0）：
 * 迭代 start/close/delete、Epic delete、项目 create/update/delete、邀请/成员/租户改名 = ADMIN；
 * 任务/评论/子任务/Epic 创建编辑、迭代创建 = 全员。
 * 角色不足统一 403 {code: FORBIDDEN, message: 仅管理员可操作}；跨租户仍 404。
 */
class RolePermissionTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    String member;
    Object sprintId;
    Object epicId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        member = fx.addMemberToA();
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects", Map.of("key", "PM", "name", "demo"));
        sprintId = fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/PM/sprints", Map.of())
                .getBody().get("id");
        epicId = fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects/PM/epics", Map.of("name", "E"))
                .getBody().get("id");
    }

    private void assertForbidden(ResponseEntity<Map> resp) {
        assertThat(resp.getStatusCode().value()).as("body=%s", resp.getBody()).isEqualTo(403);
        assertThat(resp.getBody().get("code")).isEqualTo("FORBIDDEN");
        assertThat(resp.getBody().get("message")).isEqualTo("仅管理员可操作");
    }

    @Test
    void member_cannotStartCloseDeleteSprint_403() {
        assertForbidden(fx.exchange(member, HttpMethod.POST, base + "/sprints/" + sprintId + "/start", null));
        assertForbidden(fx.exchange(member, HttpMethod.POST, base + "/sprints/" + sprintId + "/close", null));
        assertForbidden(fx.exchange(member, HttpMethod.DELETE, base + "/sprints/" + sprintId, null));
        // 状态未被改动：ADMIN 仍能正常启动
        ResponseEntity<Map> started = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/sprints/" + sprintId + "/start", null);
        assertThat(started.getStatusCode().value()).isEqualTo(200);
        assertThat(started.getBody().get("status")).isEqualTo("ACTIVE");
    }

    @Test
    void member_canCreateSprint_andCreateEditEpic_butNotDeleteEpic() {
        assertThat(fx.exchange(member, HttpMethod.POST, base + "/projects/PM/sprints", Map.of())
                .getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> created = fx.exchange(member, HttpMethod.POST,
                base + "/projects/PM/epics", Map.of("name", "成员建的"));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        assertThat(fx.exchange(member, HttpMethod.PATCH, base + "/projects/PM/epics/" + epicId,
                Map.of("name", "成员改的")).getStatusCode().value()).isEqualTo(200);
        assertForbidden(fx.exchange(member, HttpMethod.DELETE, base + "/projects/PM/epics/" + epicId, null));
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.DELETE, base + "/projects/PM/epics/" + epicId, null)
                .getStatusCode().value()).isEqualTo(204);
    }

    @Test
    void member_adminActions_403_notFoundStays404ForCrossTenant() {
        assertForbidden(fx.exchange(member, HttpMethod.POST, base + "/projects", Map.of("key", "MB", "name", "x")));
        assertForbidden(fx.exchange(member, HttpMethod.PATCH, base + "/projects/PM", Map.of("name", "x")));
        assertForbidden(fx.exchange(member, HttpMethod.DELETE, base + "/projects/PM", null));
        assertForbidden(fx.exchange(member, HttpMethod.POST, base + "/invites", Map.of("role", "MEMBER")));
        assertForbidden(fx.exchange(member, HttpMethod.PATCH, base, Map.of("name", "x")));
        // 跨租户：B 的 ADMIN 打 A 的路径仍是 404（不暴露租户存在性）
        assertThat(fx.exchange(fx.adminTokenB, HttpMethod.POST,
                base + "/sprints/" + sprintId + "/start", null).getStatusCode().value()).isEqualTo(404);
        // 角色不足优先于资源不存在：MEMBER 启动不存在的迭代也是 403，不泄露 id 空间
        assertForbidden(fx.exchange(member, HttpMethod.POST, base + "/sprints/999999/start", null));
    }
}

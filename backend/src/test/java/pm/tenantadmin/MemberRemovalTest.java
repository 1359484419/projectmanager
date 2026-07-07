package pm.tenantadmin;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;
import pm.common.ApiException;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 管理员移除成员 DELETE /api/t/{slug}/members/{userId}：
 * 仅 ADMIN（MEMBER → 404）；不能移除自己（409 CANNOT_REMOVE_SELF）；
 * 最后一个 ADMIN 不可移除（409 LAST_ADMIN，service 直测防御分支）；
 * 执行副作用：删 membership、删该租户 PAT（立即 401）、非 DONE 任务 assignee 置 NULL 并留痕。
 */
class MemberRemovalTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    MemberService memberService;

    @Autowired
    MembershipRepository memberships;

    @Autowired
    TenantRepository tenants;

    TwoTenantsFixture fx;
    String base;
    String memberToken;
    long adminUserId;
    long memberUserId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        memberToken = fx.addMemberToA();
        List<Map> members = fx.getList(fx.adminTokenA, base + "/members").getBody();
        adminUserId = userIdOf(members, "ADMIN");
        memberUserId = userIdOf(members, "MEMBER");
    }

    @AfterEach
    void cleanContext() {
        TenantContext.clear();
    }

    private static long userIdOf(List<Map> members, String role) {
        return members.stream().filter(m -> role.equals(m.get("role")))
                .map(m -> ((Number) m.get("userId")).longValue())
                .findFirst().orElseThrow();
    }

    @Test
    void membersList_containsUserIdDisplayNameRole() {
        List<Map> members = fx.getList(fx.adminTokenA, base + "/members").getBody();
        assertThat(members).hasSize(2);
        assertThat(members).allSatisfy(m -> {
            assertThat(((Map) m).get("userId")).isNotNull();
            assertThat(((Map) m).get("displayName")).isNotNull();
            assertThat(((Map) m).get("role")).isNotNull();
        });
    }

    @Test
    void adminRemovesMember_membershipGone_jwtAccess404() {
        // 成员本人此前能访问
        assertThat(fx.getList(memberToken, base + "/members").getStatusCode().value()).isEqualTo(200);

        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/members/" + memberUserId, null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);

        // 列表只剩 admin
        List<Map> after = fx.getList(fx.adminTokenA, base + "/members").getBody();
        assertThat(after).hasSize(1);
        assertThat(((Number) after.get(0).get("userId")).longValue()).isEqualTo(adminUserId);

        // 被移除者 JWT 访问该租户 → 404
        ResponseEntity<Map> removed = fx.exchange(memberToken, HttpMethod.GET,
                base + "/members", null);
        assertThat(removed.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void memberCallsRemove_404() {
        ResponseEntity<Map> resp = fx.exchange(memberToken, HttpMethod.DELETE,
                base + "/members/" + adminUserId, null);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void removeSelf_409CannotRemoveSelf() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/members/" + adminUserId, null);
        assertThat(resp.getStatusCode().value()).isEqualTo(409);
        assertThat(resp.getBody().get("code")).isEqualTo("CANNOT_REMOVE_SELF");
        // 未被删
        assertThat(fx.getList(fx.adminTokenA, base + "/members").getBody()).hasSize(2);
    }

    @Test
    void removeUnknownUser_404() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/members/999999", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void removeLastAdmin_409LastAdmin_serviceLevel() {
        // REST 上操作者本人必为 ADMIN 且不能删自己，正常流程撞不到该分支；
        // service 直测防御逻辑：以 member 为 actor（伪造 ADMIN 上下文）删唯一 ADMIN。
        long tenantId = tenants.findBySlug(fx.slugA).orElseThrow().getId();
        TenantContext.set(tenantId, Membership.Role.ADMIN);
        assertThatThrownBy(() -> memberService.remove(adminUserId, memberUserId))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("LAST_ADMIN");
                    assertThat(e.getStatus().value()).isEqualTo(409);
                });
        // 未被删
        assertThat(memberships.findByUserIdAndTenantId(adminUserId, tenantId)).isPresent();
    }

    @Test
    void removedMemberPat_immediately401() {
        // member 给租户 A 建 PAT
        ResponseEntity<Map> created = fx.exchange(memberToken, HttpMethod.POST,
                "/api/me/tokens", Map.of("name", "cli", "tenantSlug", fx.slugA));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        String pat = (String) created.getBody().get("token");
        assertThat(fx.getList(pat, base + "/members").getStatusCode().value()).isEqualTo(200);

        fx.exchange(fx.adminTokenA, HttpMethod.DELETE, base + "/members/" + memberUserId, null);

        ResponseEntity<Map> after = fx.exchange(pat, HttpMethod.GET, base + "/members", null);
        assertThat(after.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void nonDoneTasksUnassigned_withActivity_doneTasksKept() {
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo"));
        long todoId = createAssignedTask("todo任务");
        long doneId = createAssignedTask("done任务");
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + doneId,
                Map.of("status", "DONE"));

        fx.exchange(fx.adminTokenA, HttpMethod.DELETE, base + "/members/" + memberUserId, null);

        // 非 DONE 任务 assignee 置 NULL
        ResponseEntity<Map> todo = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + todoId, null);
        assertThat(todo.getBody().get("assigneeId")).isNull();
        // DONE 任务保留 assignee
        ResponseEntity<Map> done = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + doneId, null);
        assertThat(((Number) done.getBody().get("assigneeId")).longValue()).isEqualTo(memberUserId);

        // activity 留痕：ASSIGNED，old=memberUserId，new=null，actor=操作者（admin）
        List<Map> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + todoId + "/activities").getBody();
        assertThat(acts).anySatisfy(a -> {
            assertThat(a.get("type")).isEqualTo("ASSIGNED");
            assertThat(a.get("oldValue")).isEqualTo(String.valueOf(memberUserId));
            assertThat(a.get("newValue")).isNull();
            assertThat(((Number) a.get("actorId")).longValue()).isEqualTo(adminUserId);
        });
    }

    private long createAssignedTask(String title) {
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", title, "assigneeId", memberUserId));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        return ((Number) t.getBody().get("id")).longValue();
    }
}

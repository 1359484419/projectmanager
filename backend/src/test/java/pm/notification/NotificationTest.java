package pm.notification;

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
 * 消息中心：指派触发（创建带 assignee / 改指派人）、自己指派自己不通知、
 * 单条已读/全部已读（只能标自己的）、任务删除级联、跨租户隔离。
 */
class NotificationTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    String memberToken;
    Object memberUserId;
    Object adminUserId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo")).getStatusCode().value()).isEqualTo(200);
        memberToken = fx.addMemberToA();
        // 从成员列表分辨 admin / member 的 userId
        List<Map> members = fx.getList(fx.adminTokenA, base + "/members").getBody();
        for (Map m : members) {
            if ("ADMIN".equals(m.get("role"))) {
                adminUserId = m.get("userId");
            } else {
                memberUserId = m.get("userId");
            }
        }
        assertThat(adminUserId).isNotNull();
        assertThat(memberUserId).isNotNull();
    }

    private Map createTask(Object assigneeId) {
        Map<String, Object> body = assigneeId == null
                ? Map.of("type", "TASK", "title", "t")
                : Map.of("type", "TASK", "title", "t", "assigneeId", assigneeId);
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private Map list(String token) {
        ResponseEntity<Map> resp = fx.exchange(token, HttpMethod.GET, base + "/notifications", null);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void assignOnCreate_notifiesAssignee_notActor() {
        Map task = createTask(memberUserId);

        // 被指派人收到未读通知，含标题与 displayKey
        Map view = list(memberToken);
        assertThat(((Number) view.get("unreadCount")).longValue()).isEqualTo(1);
        Map item = (Map) ((List) view.get("items")).get(0);
        assertThat(item.get("taskId")).isEqualTo(task.get("id"));
        assertThat(item.get("type")).isEqualTo("TASK_ASSIGNED");
        assertThat(item.get("taskTitle")).isEqualTo("t");
        assertThat((String) item.get("displayKey")).startsWith("PM-");
        assertThat(item.get("projectKey")).isEqualTo("PM");
        assertThat(item.get("readAt")).isNull();

        // 操作者（admin）自己没有通知
        assertThat(((Number) list(fx.adminTokenA).get("unreadCount")).longValue()).isZero();
    }

    @Test
    void selfAssign_noNotification() {
        createTask(adminUserId); // admin 建任务指派给自己
        assertThat(((Number) list(fx.adminTokenA).get("unreadCount")).longValue()).isZero();
    }

    @Test
    void reassign_notifiesNewAssignee() {
        Map task = createTask(null); // 无指派创建 → 无通知
        assertThat(((Number) list(fx.adminTokenA).get("unreadCount")).longValue()).isZero();
        assertThat(((Number) list(memberToken).get("unreadCount")).longValue()).isZero();

        // admin 把任务指派给 member → member 收到
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH, base + "/tasks/" + task.get("id"),
                Map.of("assigneeId", memberUserId));
        assertThat(((Number) list(memberToken).get("unreadCount")).longValue()).isEqualTo(1);

        // member 把任务指回 admin → admin 收到
        fx.exchange(memberToken, HttpMethod.PATCH, base + "/tasks/" + task.get("id"),
                Map.of("assigneeId", adminUserId));
        assertThat(((Number) list(fx.adminTokenA).get("unreadCount")).longValue()).isEqualTo(1);
    }

    @Test
    void markRead_singleAndAll_ownOnly() {
        createTask(memberUserId);
        createTask(memberUserId);
        Map view = list(memberToken);
        assertThat(((Number) view.get("unreadCount")).longValue()).isEqualTo(2);
        Object firstId = ((Map) ((List) view.get("items")).get(0)).get("id");

        // 别人（admin）标 member 的通知 → 204 但不生效（WHERE user_id 不匹配）
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/notifications/" + firstId + "/read", null)
                .getStatusCode().value()).isEqualTo(204);
        assertThat(((Number) list(memberToken).get("unreadCount")).longValue()).isEqualTo(2);

        // 本人标单条 → 未读 1，条目仍在列表（保留已读历史）
        assertThat(fx.exchange(memberToken, HttpMethod.POST,
                base + "/notifications/" + firstId + "/read", null)
                .getStatusCode().value()).isEqualTo(204);
        Map after = list(memberToken);
        assertThat(((Number) after.get("unreadCount")).longValue()).isEqualTo(1);
        assertThat((List) after.get("items")).hasSize(2);

        // 全部已读
        assertThat(fx.exchange(memberToken, HttpMethod.POST,
                base + "/notifications/read-all", null).getStatusCode().value()).isEqualTo(204);
        assertThat(((Number) list(memberToken).get("unreadCount")).longValue()).isZero();
    }

    @Test
    void taskDelete_cascadesNotifications() {
        Map task = createTask(memberUserId);
        assertThat(((Number) list(memberToken).get("unreadCount")).longValue()).isEqualTo(1);

        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/tasks/" + task.get("id"), null).getStatusCode().value()).isEqualTo(204);
        Map after = list(memberToken);
        assertThat(((Number) after.get("unreadCount")).longValue()).isZero();
        assertThat((List) after.get("items")).isEmpty();
    }

    @Test
    void crossTenant_isolated() {
        createTask(memberUserId);
        // 租户 B 的 admin 访问租户 A 的通知端点 → 404（非成员）
        ResponseEntity<Map> denied = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                base + "/notifications", null);
        assertThat(denied.getStatusCode().value()).isEqualTo(404);
        // 租户 B 自己的列表为空
        Map own = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/notifications", null).getBody();
        assertThat(((Number) own.get("unreadCount")).longValue()).isZero();
    }
}

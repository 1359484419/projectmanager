package pm.task;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 记录模块：RECORD 创建（可带 remindAt）、records 列表、
 * due 只含到期未关闭且本人创建的、dismiss 幂等且关闭后不再弹、跨租户 404。
 */
class RecordFlowTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PM", "name", "demo"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
    }

    private Map createRecord(String title, Instant remindAt) {
        Map<String, Object> body = remindAt == null
                ? Map.of("type", "RECORD", "title", title, "description", "发票内容")
                : Map.of("type", "RECORD", "title", title, "description", "发票内容",
                        "remindAt", remindAt.toString());
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void recordLifecycle_dueOnlyExpired_dismissStops() {
        Map plain = createRecord("发票报销-无提醒", null);
        Map dueRec = createRecord("发票报销-已到期", Instant.now().minusSeconds(60));
        Map future = createRecord("发票报销-未到期", Instant.now().plusSeconds(3600));
        assertThat(plain.get("type")).isEqualTo("RECORD");
        assertThat(dueRec.get("remindAt")).isNotNull();

        // records 列表：含全部 3 条
        ResponseEntity<List> records = fx.getList(fx.adminTokenA, base + "/projects/PM/records");
        assertThat(records.getStatusCode().value()).isEqualTo(200);
        assertThat(records.getBody()).hasSize(3);

        // due：只有已到期未关闭的那条
        ResponseEntity<List> due = fx.getList(fx.adminTokenA, base + "/records/due");
        assertThat(due.getBody()).hasSize(1);
        Map dueItem = (Map) due.getBody().get(0);
        assertThat(dueItem.get("title")).isEqualTo("发票报销-已到期");

        // 记录是创建者私有：他人（成员）看不到提醒、列表、详情、搜索结果
        String memberToken = fx.addMemberToA();
        assertThat(fx.getList(memberToken, base + "/records/due").getBody()).isEmpty();
        assertThat(fx.getList(memberToken, base + "/projects/PM/records").getBody()).isEmpty();
        Long plainId = ((Number) plain.get("id")).longValue();
        assertThat(fx.exchange(memberToken, HttpMethod.GET,
                base + "/tasks/" + plainId, null).getStatusCode().value()).isEqualTo(404);
        assertThat(fx.getList(memberToken, base + "/tasks/search?q=" + java.net.URLEncoder.encode("发票报销", java.nio.charset.StandardCharsets.UTF_8)).getBody()).isEmpty();
        // 创建者自己都正常
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + plainId, null).getStatusCode().value()).isEqualTo(200);
        // 记录不出现在 backlog（后端排除）
        boolean backlogHasRecord = ((java.util.List<?>) fx.getList(fx.adminTokenA, base + "/projects/PM/backlog").getBody())
                .stream().anyMatch(o -> "RECORD".equals(((Map<?, ?>) o).get("type")));
        assertThat(backlogHasRecord).isFalse();

        // dismiss 后不再弹；重复 dismiss 幂等
        Long dueId = ((Number) dueItem.get("id")).longValue();
        ResponseEntity<Map> dis = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/records/" + dueId + "/dismiss", null);
        assertThat(dis.getStatusCode().value()).isEqualTo(204);
        assertThat(fx.getList(fx.adminTokenA, base + "/records/due").getBody()).isEmpty();
        assertThat(fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/records/" + dueId + "/dismiss", null)
                .getStatusCode().value()).isEqualTo(204);

        // 跨租户：B 租户 admin 摸不到 A 的记录
        Long anyId = ((Number) plain.get("id")).longValue();
        assertThat(fx.exchange(fx.adminTokenB, HttpMethod.POST,
                "/api/t/" + fx.slugB + "/records/" + anyId + "/dismiss", null)
                .getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void nonRecordType_ignoresRemindAt() {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks",
                Map.of("type", "TASK", "title", "普通任务", "remindAt", Instant.now().toString()));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody().get("remindAt")).isNull();
    }
}

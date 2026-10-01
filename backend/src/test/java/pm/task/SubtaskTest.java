package pm.task;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 子任务：增删改查、done 切换、标题校验（空白/超长 400）、
 * 删主任务级联删子任务、跨租户隔离 404。
 */
class SubtaskTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    TwoTenantsFixture fx;
    String base;
    Object taskId;

    @BeforeEach
    void setUp() {
        fx = new TwoTenantsFixture(rest);
        base = "/api/t/" + fx.slugA;
        ResponseEntity<Map> p = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects", Map.of("key", "PM", "name", "demo"));
        assertThat(p.getStatusCode().value()).isEqualTo(200);
        ResponseEntity<Map> t = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "主任务"));
        assertThat(t.getStatusCode().value()).isEqualTo(200);
        taskId = t.getBody().get("id");
    }

    private Map createSubtask(String title) {
        ResponseEntity<Map> resp = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", title));
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    private List<Map> listSubtasks() {
        ResponseEntity<List> resp = fx.getList(fx.adminTokenA,
                base + "/tasks/" + taskId + "/subtasks");
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        return resp.getBody();
    }

    @Test
    void crud_andDoneToggle() {
        // 创建：默认未完成，按 id 升序列出
        Map s1 = createSubtask("写文档");
        Map s2 = createSubtask("补测试");
        assertThat(s1.get("done")).isEqualTo(false);
        assertThat(s1.get("taskId")).isEqualTo(taskId);
        assertThat(s1.get("createdAt")).isNotNull();
        List<Map> list = listSubtasks();
        assertThat(list).extracting(m -> m.get("title")).containsExactly("写文档", "补测试");

        // done 切换：false → true → false
        ResponseEntity<Map> done = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s1.get("id"), Map.of("done", true));
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(done.getBody().get("done")).isEqualTo(true);
        ResponseEntity<Map> undone = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s1.get("id"), Map.of("done", false));
        assertThat(undone.getBody().get("done")).isEqualTo(false);

        // 改标题
        ResponseEntity<Map> renamed = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s2.get("id"), Map.of("title", "补集成测试"));
        assertThat(renamed.getStatusCode().value()).isEqualTo(200);
        assertThat(renamed.getBody().get("title")).isEqualTo("补集成测试");

        // 删除 → 204，列表只剩一条
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/subtasks/" + s1.get("id"), null);
        assertThat(del.getStatusCode().value()).isEqualTo(204);
        assertThat(listSubtasks()).extracting(m -> m.get("title")).containsExactly("补集成测试");
    }

    @Test
    void titleValidation_blankAndTooLong_400() {
        // 创建：空白标题 → 400
        ResponseEntity<Map> blank = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", "   "));
        assertThat(blank.getStatusCode().value()).isEqualTo(400);
        // 创建：超 200 字符 → 400
        ResponseEntity<Map> tooLong = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + taskId + "/subtasks", Map.of("title", "a".repeat(201)));
        assertThat(tooLong.getStatusCode().value()).isEqualTo(400);
        assertThat(tooLong.getBody().get("code")).isEqualTo("VALIDATION");
        // PATCH：空白标题 → 400
        Map s = createSubtask("正常");
        ResponseEntity<Map> patchBlank = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("title", " "));
        assertThat(patchBlank.getStatusCode().value()).isEqualTo(400);
        // 不存在的主任务 → 404
        ResponseEntity<Map> noTask = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/999999/subtasks", Map.of("title", "x"));
        assertThat(noTask.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void deleteTask_cascadesSubtasks() {
        createSubtask("会被级联删");
        // 删主任务
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/tasks/" + taskId, null);
        assertThat(del.getStatusCode().value()).isEqualTo(204);
        // 主任务没了 → 子任务列表 404（挂在已删任务下；404 响应体是错误对象，用 Map 接）
        ResponseEntity<Map> list = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId + "/subtasks", null);
        assertThat(list.getStatusCode().value()).isEqualTo(404);
        // 再建一个同项目任务，确认库里不会串（新任务子任务为空）
        ResponseEntity<Map> t2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "新任务"));
        ResponseEntity<List> empty = fx.getList(fx.adminTokenA,
                base + "/tasks/" + t2.getBody().get("id") + "/subtasks");
        assertThat(empty.getBody()).isEmpty();
    }

    @Test
    void crossTenant_isolation_404() {
        Map s = createSubtask("隔离");
        // B 租户走 A 的路径 → 404（404 响应体是错误对象，用 Map 接）
        ResponseEntity<Map> crossList = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                base + "/tasks/" + taskId + "/subtasks", null);
        assertThat(crossList.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<Map> crossPatch = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("done", true));
        assertThat(crossPatch.getStatusCode().value()).isEqualTo(404);
        // B 用自己的租户路径打 A 的 subtask id → 404（tenant_id 过滤）
        ResponseEntity<Map> crossOwnPath = fx.exchange(fx.adminTokenB, HttpMethod.PATCH,
                "/api/t/" + fx.slugB + "/subtasks/" + s.get("id"), Map.of("done", true));
        assertThat(crossOwnPath.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<Map> crossDelete = fx.exchange(fx.adminTokenB, HttpMethod.DELETE,
                "/api/t/" + fx.slugB + "/subtasks/" + s.get("id"), null);
        assertThat(crossDelete.getStatusCode().value()).isEqualTo(404);
        // A 的数据未被影响
        assertThat(listSubtasks()).hasSize(1);
        assertThat(listSubtasks().get(0).get("done")).isEqualTo(false);
    }

    @Test
    void progressCounts_inBacklog() {
        Map s1 = createSubtask("一");
        createSubtask("二");
        createSubtask("三");
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s1.get("id"), Map.of("done", true));

        ResponseEntity<List> backlog = fx.getList(fx.adminTokenA, base + "/projects/PM/backlog");
        assertThat(backlog.getStatusCode().value()).isEqualTo(200);
        Map row = (Map) backlog.getBody().stream()
                .filter(m -> ((Map) m).get("id").equals(taskId)).findFirst().orElseThrow();
        assertThat(row.get("subtaskTotal")).isEqualTo(3);
        assertThat(row.get("subtaskDone")).isEqualTo(1);
    }

    @Test
    void activities_andTaskUpdatedAt() {
        // 任务刚建时 updated_at == created_at
        ResponseEntity<Map> before = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null);
        assertThat(before.getBody().get("updatedAt")).isEqualTo(before.getBody().get("createdAt"));

        Map s = createSubtask("留痕");
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("done", true));
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("title", "留痕改名"));
        fx.exchange(fx.adminTokenA, HttpMethod.DELETE, base + "/subtasks/" + s.get("id"), null);

        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + taskId + "/activities");
        assertThat(acts.getBody()).extracting(m -> ((Map) m).get("type"))
                .contains("SUBTASK_CREATED", "SUBTASK_DONE", "SUBTASK_RENAMED", "SUBTASK_DELETED");

        // 子任务写操作推进主任务 updated_at（日报取数）
        ResponseEntity<Map> after = fx.exchange(fx.adminTokenA, HttpMethod.GET,
                base + "/tasks/" + taskId, null);
        assertThat(after.getBody().get("updatedAt"))
                .isNotEqualTo(after.getBody().get("createdAt"));
    }

    @Test
    void doneTrail_doneAtDoneBy_setAndCleared() {
        // 租户 A 只有 admin 一个成员，取其 userId 作断言基准
        ResponseEntity<List> members = fx.getList(fx.adminTokenA, base + "/members");
        Object adminId = ((Map) members.getBody().get(0)).get("userId");

        Map s = createSubtask("勾选");
        ResponseEntity<Map> done = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("done", true));
        assertThat(done.getBody().get("doneAt")).isNotNull();
        assertThat(done.getBody().get("doneBy")).isEqualTo(adminId);

        ResponseEntity<Map> undone = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("done", false));
        assertThat(undone.getBody().get("doneAt")).isNull();
        assertThat(undone.getBody().get("doneBy")).isNull();
    }

    @Test
    void reorder_byRankAnchors() {
        Map a = createSubtask("甲");
        Map b = createSubtask("乙");
        Map c = createSubtask("丙");
        assertThat(listSubtasks()).extracting(m -> m.get("title"))
                .containsExactly("甲", "乙", "丙");

        // 丙 提到最前（beforeId = 甲）
        ResponseEntity<Map> toTop = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + c.get("id"),
                Map.of("rank", Map.of("beforeId", a.get("id"))));
        assertThat(toTop.getStatusCode().value()).isEqualTo(200);
        assertThat(listSubtasks()).extracting(m -> m.get("title"))
                .containsExactly("丙", "甲", "乙");

        // 甲 移到 乙 之后（afterId = 乙）→ 丙、乙、甲
        ResponseEntity<Map> afterB = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + a.get("id"),
                Map.of("rank", Map.of("afterId", b.get("id"))));
        assertThat(afterB.getStatusCode().value()).isEqualTo(200);
        assertThat(listSubtasks()).extracting(m -> m.get("title"))
                .containsExactly("丙", "乙", "甲");

        // 锚点是别的任务的子任务 → 400
        ResponseEntity<Map> t2 = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "另一个任务"));
        ResponseEntity<Map> other = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/tasks/" + t2.getBody().get("id") + "/subtasks", Map.of("title", "外人"));
        ResponseEntity<Map> bad = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + a.get("id"),
                Map.of("rank", Map.of("afterId", other.getBody().get("id"))));
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void details_descriptionAssigneeDue() {
        ResponseEntity<List> members = fx.getList(fx.adminTokenA, base + "/members");
        Object adminId = ((Map) members.getBody().get(0)).get("userId");

        Map s = createSubtask("详情");
        assertThat(s.get("description")).isNull();
        assertThat(s.get("assigneeId")).isNull();
        assertThat(s.get("dueDate")).isNull();

        // 三字段一次更新
        ResponseEntity<Map> up = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"),
                Map.of("description", "详细说明", "assigneeId", adminId, "dueDate", "2026-10-01"));
        assertThat(up.getStatusCode().value()).isEqualTo(200);
        assertThat(up.getBody().get("description")).isEqualTo("详细说明");
        assertThat(up.getBody().get("assigneeId")).isEqualTo(adminId);
        assertThat(up.getBody().get("dueDate")).isEqualTo("2026-10-01");

        // 显式 null 三态清空（Map.of 不收 null，用 HashMap）
        Map<String, Object> clear = new java.util.HashMap<>();
        clear.put("description", null);
        clear.put("assigneeId", null);
        clear.put("dueDate", null);
        ResponseEntity<Map> cleared = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), clear);
        assertThat(cleared.getBody().get("description")).isNull();
        assertThat(cleared.getBody().get("assigneeId")).isNull();
        assertThat(cleared.getBody().get("dueDate")).isNull();

        // 字段缺省不改：只传 title，详情保持 null 且不回填
        ResponseEntity<Map> untouched = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("title", "详情改名"));
        assertThat(untouched.getBody().get("description")).isNull();

        // 非本租户成员 → 400 INVALID_ASSIGNEE
        ResponseEntity<Map> badAssignee = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("assigneeId", 999999));
        assertThat(badAssignee.getStatusCode().value()).isEqualTo(400);
        assertThat(badAssignee.getBody().get("code")).isEqualTo("INVALID_ASSIGNEE");

        // 非法日期 → 400 VALIDATION
        ResponseEntity<Map> badDate = fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"), Map.of("dueDate", "10月1日"));
        assertThat(badDate.getStatusCode().value()).isEqualTo(400);
        assertThat(badDate.getBody().get("code")).isEqualTo("VALIDATION");

        // 指派/到期日留痕（清空也算）
        fx.exchange(fx.adminTokenA, HttpMethod.PATCH,
                base + "/subtasks/" + s.get("id"),
                Map.of("assigneeId", adminId, "dueDate", "2026-10-01"));
        ResponseEntity<List> acts = fx.getList(fx.adminTokenA, base + "/tasks/" + taskId + "/activities");
        assertThat(acts.getBody()).extracting(m -> ((Map) m).get("type"))
                .contains("SUBTASK_ASSIGNED", "SUBTASK_DUE_CHANGED");
    }

    @Test
    void images_uploadListBytes_crossTenant404() throws Exception {
        Map s = createSubtask("带图");
        // 1x1 PNG
        byte[] png = java.util.Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.setContentType(org.springframework.http.MediaType.MULTIPART_FORM_DATA);
        headers.setBearerAuth(fx.adminTokenA);
        ByteArrayResource file = new ByteArrayResource(png) {
            @Override
            public String getFilename() {
                return "a.png";
            }
        };
        org.springframework.util.MultiValueMap<String, Object> body =
                new org.springframework.util.LinkedMultiValueMap<>();
        body.add("file", file);
        ResponseEntity<Map> up = rest.exchange(base + "/subtasks/" + s.get("id") + "/images",
                HttpMethod.POST, new org.springframework.http.HttpEntity<>(body, headers), Map.class);
        assertThat(up.getStatusCode().value()).isEqualTo(200);
        assertThat(up.getBody().get("filename")).isEqualTo("a.png");
        Object imageId = up.getBody().get("id");

        // 文档附件：PDF 也放行（附件不只图片）
        byte[] pdf = "%PDF-1.4 fake".getBytes();
        ByteArrayResource docFile = new ByteArrayResource(pdf) {
            @Override
            public String getFilename() {
                return "spec.pdf";
            }
        };
        org.springframework.util.MultiValueMap<String, Object> docBody =
                new org.springframework.util.LinkedMultiValueMap<>();
        docBody.add("file", docFile);
        ResponseEntity<Map> docUp = rest.exchange(base + "/subtasks/" + s.get("id") + "/images",
                HttpMethod.POST,
                new org.springframework.http.HttpEntity<>(docBody, authHeadersMultipart(fx.adminTokenA)),
                Map.class);
        assertThat(docUp.getStatusCode().value()).isEqualTo(200);

        // 可执行文件等未白名单类型 → 400
        ByteArrayResource exeFile = new ByteArrayResource("MZ".getBytes()) {
            @Override
            public String getFilename() {
                return "a.exe";
            }
        };
        org.springframework.util.MultiValueMap<String, Object> exeBody =
                new org.springframework.util.LinkedMultiValueMap<>();
        exeBody.add("file", exeFile);
        org.springframework.http.HttpHeaders exeHeaders = authHeaders(fx.adminTokenA);
        exeHeaders.setContentType(org.springframework.http.MediaType.MULTIPART_FORM_DATA);
        ResponseEntity<Map> exeUp = rest.exchange(base + "/subtasks/" + s.get("id") + "/images",
                HttpMethod.POST, new org.springframework.http.HttpEntity<>(exeBody, exeHeaders),
                Map.class);
        assertThat(exeUp.getStatusCode().value()).isEqualTo(400);
        assertThat(exeUp.getBody().get("code")).isEqualTo("INVALID_ATTACHMENT");

        // 元数据列表（图片 + 文档）
        ResponseEntity<List> list = fx.getList(fx.adminTokenA,
                base + "/subtasks/" + s.get("id") + "/images");
        assertThat(list.getBody()).hasSize(2);

        // 字节流一致
        ResponseEntity<byte[]> bytes = rest.exchange(base + "/subtask-images/" + imageId,
                HttpMethod.GET, new org.springframework.http.HttpEntity<>(null, authHeaders(fx.adminTokenA)),
                byte[].class);
        assertThat(bytes.getStatusCode().value()).isEqualTo(200);
        assertThat(bytes.getBody()).isEqualTo(png);
        // 防 MIME 嗅探；图片 inline 展示
        assertThat(bytes.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(bytes.getHeaders().getFirst("Content-Disposition"))
                .isEqualTo("inline; filename*=UTF-8''a.png");

        // 非图片附件：强制下载（attachment），文件名 RFC 5987 编码
        ResponseEntity<byte[]> pdfBytes = rest.exchange(base + "/subtask-images/" + docUp.getBody().get("id"),
                HttpMethod.GET, new org.springframework.http.HttpEntity<>(null, authHeaders(fx.adminTokenA)),
                byte[].class);
        assertThat(pdfBytes.getStatusCode().value()).isEqualTo(200);
        assertThat(pdfBytes.getBody()).isEqualTo(pdf);
        assertThat(pdfBytes.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(pdfBytes.getHeaders().getFirst("Content-Disposition"))
                .isEqualTo("attachment; filename*=UTF-8''spec.pdf");

        // 跨租户读字节 → 404
        ResponseEntity<Map> cross = fx.exchange(fx.adminTokenB, HttpMethod.GET,
                "/api/t/" + fx.slugB + "/subtask-images/" + imageId, null);
        assertThat(cross.getStatusCode().value()).isEqualTo(404);
        // 跨租户上传 → 404
        ResponseEntity<Map> crossUp = rest.exchange(
                "/api/t/" + fx.slugB + "/subtasks/" + s.get("id") + "/images",
                HttpMethod.POST, new org.springframework.http.HttpEntity<>(body, authHeadersMultipart(fx.adminTokenB)),
                Map.class);
        assertThat(crossUp.getStatusCode().value()).isEqualTo(404);

        // 删除单个附件：跨租户 404；本租户 204，字节流随之 404，列表只剩 PDF
        ResponseEntity<Map> crossDel = fx.exchange(fx.adminTokenB, HttpMethod.DELETE,
                "/api/t/" + fx.slugB + "/subtask-images/" + imageId, null);
        assertThat(crossDel.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<Map> del = fx.exchange(fx.adminTokenA, HttpMethod.DELETE,
                base + "/subtask-images/" + imageId, null);
        assertThat(del.getStatusCode().value()).isEqualTo(204);
        ResponseEntity<Map> gone = rest.exchange(base + "/subtask-images/" + imageId,
                HttpMethod.GET, new org.springframework.http.HttpEntity<>(null, authHeaders(fx.adminTokenA)),
                Map.class);
        assertThat(gone.getStatusCode().value()).isEqualTo(404);
        ResponseEntity<List> afterDel = fx.getList(fx.adminTokenA,
                base + "/subtasks/" + s.get("id") + "/images");
        assertThat(afterDel.getBody()).hasSize(1);
    }

    @Test
    void rfc5987_encodesNonAsciiAndSpaces() {
        assertThat(SubtaskImageController.rfc5987("a.png")).isEqualTo("a.png");
        assertThat(SubtaskImageController.rfc5987("需求 v1.pdf"))
                .isEqualTo("%E9%9C%80%E6%B1%82%20v1.pdf");
        // 分号/引号/换行不得裸露进头部
        assertThat(SubtaskImageController.rfc5987("a;b\"c\r\n.txt")).isEqualTo("a%3Bb%22c%0D%0A.txt");
    }

    private static org.springframework.http.HttpHeaders authHeaders(String token) {
        org.springframework.http.HttpHeaders h = new org.springframework.http.HttpHeaders();
        h.setBearerAuth(token);
        return h;
    }

    private static org.springframework.http.HttpHeaders authHeadersMultipart(String token) {
        org.springframework.http.HttpHeaders h = authHeaders(token);
        h.setContentType(org.springframework.http.MediaType.MULTIPART_FORM_DATA);
        return h;
    }
}

package pm.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 权限矩阵架构测试（harness 兜底层，纯反射不需要 Docker）：
 * 反射枚举全部 /api/t/** 的写端点（POST/PATCH/PUT/DELETE），每个端点要么标了 {@link RequireRole}，
 * 要么显式列在下面的「全员可写」白名单里——新增写端点时必须二选一，防止权限矩阵静默漏项。
 */
class WritePermissionMatrixTest {

    /** 全员（ADMIN 与 MEMBER）都可调用的写端点；旁注说明为何不需要角色。 */
    static final Set<String> ALL_MEMBERS_WRITABLE = Set.of(
            // 任务：全员可建可改；删除 = 创建者或 ADMIN（TaskService.delete 判）
            "POST /api/t/{slug}/projects/{key}/tasks",
            "PATCH /api/t/{slug}/tasks/{id}",
            "DELETE /api/t/{slug}/tasks/{id}",
            // 评论 / 子任务 / 记录图片：全员
            "POST /api/t/{slug}/tasks/{id}/comments",
            "POST /api/t/{slug}/tasks/{taskId}/subtasks",
            "PATCH /api/t/{slug}/subtasks/{id}",
            "DELETE /api/t/{slug}/subtasks/{id}",
            "POST /api/t/{slug}/tasks/{taskId}/images",
            "POST /api/t/{slug}/subtasks/{subtaskId}/images",
            "DELETE /api/t/{slug}/subtask-images/{imageId}",
            // Epic：创建与编辑全员，删除 ADMIN（标注）
            "POST /api/t/{slug}/projects/{key}/epics",
            "PATCH /api/t/{slug}/projects/{key}/epics/{id}",
            // 迭代：创建全员；start/close/delete ADMIN（标注）
            "POST /api/t/{slug}/projects/{key}/sprints",
            // 容量覆盖：ADMIN 或本人（CapacityService.upsertOverride 判，他人 → 403）
            "PUT /api/t/{slug}/sprints/{id}/capacity/{userId}",
            // 个人资源：只作用于当前用户自己的数据
            "POST /api/t/{slug}/records/{id}/dismiss",
            "POST /api/t/{slug}/notifications/{id}/read",
            "POST /api/t/{slug}/notifications/read-all",
            // 助手反代：真正的写由助手回调 REST 端点，角色在那里判
            "POST /api/t/{slug}/assistant/**",
            "PUT /api/t/{slug}/assistant/**",
            "PATCH /api/t/{slug}/assistant/**",
            "DELETE /api/t/{slug}/assistant/**");

    private static final Set<RequestMethod> WRITE_METHODS = Set.of(
            RequestMethod.POST, RequestMethod.PATCH, RequestMethod.PUT, RequestMethod.DELETE);

    @Test
    void everyTenantWriteEndpoint_declaresRoleOrIsExplicitlyAllMembers() throws Exception {
        Set<String> endpoints = tenantWriteEndpoints(true);
        Set<String> annotated = tenantWriteEndpoints(false);
        assertThat(endpoints).as("至少应扫到写端点（防扫描失效空转）").hasSizeGreaterThan(10);

        List<String> violations = new ArrayList<>();
        for (String ep : endpoints) {
            boolean declared = annotated.contains(ep);
            boolean whitelisted = ALL_MEMBERS_WRITABLE.contains(ep);
            if (!declared && !whitelisted) {
                violations.add(ep + "：未标 @RequireRole，也不在 ALL_MEMBERS_WRITABLE 白名单里");
            }
            if (declared && whitelisted) {
                violations.add(ep + "：既标了 @RequireRole 又在白名单里，二选一");
            }
        }
        for (String w : ALL_MEMBERS_WRITABLE) {
            if (!endpoints.contains(w)) {
                violations.add(w + "：白名单里的端点不存在（过期条目，请删除）");
            }
        }
        assertThat(violations)
                .as("权限矩阵漏项：%n%s", String.join("\n", violations))
                .isEmpty();
    }

    /** 反射枚举 pm 包下全部 @RestController 的 /api/t/** 写端点，格式 "METHOD path"。 */
    private static Set<String> tenantWriteEndpoints(boolean all) throws ClassNotFoundException {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        Set<String> result = new TreeSet<>();
        for (BeanDefinition bd : scanner.findCandidateComponents("pm")) {
            Class<?> cls = Class.forName(bd.getBeanClassName());
            RequestMapping classMapping = AnnotatedElementUtils.findMergedAnnotation(cls, RequestMapping.class);
            String[] prefixes = classMapping == null || classMapping.path().length == 0
                    ? new String[]{""} : classMapping.path();
            for (Method m : cls.getDeclaredMethods()) {
                RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(m, RequestMapping.class);
                if (mapping == null) {
                    continue;
                }
                if (!all && !m.isAnnotationPresent(RequireRole.class)) {
                    continue;
                }
                RequestMethod[] methods = mapping.method().length == 0
                        ? RequestMethod.values() : mapping.method();
                String[] paths = mapping.path().length == 0 ? new String[]{""} : mapping.path();
                for (String prefix : prefixes) {
                    for (String path : paths) {
                        String full = prefix + path;
                        if (!full.startsWith("/api/t/")) {
                            continue;
                        }
                        for (RequestMethod rm : methods) {
                            if (WRITE_METHODS.contains(rm)) {
                                result.add(rm + " " + full);
                            }
                        }
                    }
                }
            }
        }
        return result;
    }
}

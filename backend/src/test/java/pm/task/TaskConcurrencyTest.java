package pm.task;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import pm.IntegrationTest;
import pm.TwoTenantsFixture;
import pm.tenant.TenantContext;
import pm.tenantadmin.Membership;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 并发 PATCH 同一任务不同字段：后提交的事务必须因乐观锁冲突失败（连同其 activity 一起回滚），
 * 而不是用旧快照全字段 UPDATE 把先提交的变更覆盖回旧值（丢更新 + 审计与数据矛盾）。
 */
class TaskConcurrencyTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TaskService taskService;

    @Autowired
    PlatformTransactionManager txManager;

    @Test
    void concurrentPatchDifferentFields_laterCommitConflicts_noLostUpdate() throws Exception {
        TwoTenantsFixture fx = new TwoTenantsFixture(rest);
        String base = "/api/t/" + fx.slugA;
        fx.exchange(fx.adminTokenA, HttpMethod.POST, base + "/projects",
                Map.of("key", "PM", "name", "demo"));
        ResponseEntity<Map> created = fx.exchange(fx.adminTokenA, HttpMethod.POST,
                base + "/projects/PM/tasks", Map.of("type", "TASK", "title", "并发基线标题"));
        assertThat(created.getStatusCode().value()).isEqualTo(200);
        long taskId = ((Number) created.getBody().get("id")).longValue();
        long tenantId = jdbc.queryForObject(
                "SELECT tenant_id FROM tasks WHERE id = ?", Long.class, taskId);
        long actorId = jdbc.queryForObject(
                "SELECT user_id FROM memberships WHERE tenant_id = ? LIMIT 1", Long.class, tenantId);

        TransactionTemplate tx = new TransactionTemplate(txManager);
        CountDownLatch slowLoaded = new CountDownLatch(1);
        CountDownLatch fastCommitted = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            // 慢事务：先把任务读进持久化上下文（旧版本），等快事务提交后再改 title 并提交
            Future<?> slow = pool.submit(() -> {
                TenantContext.set(tenantId, Membership.Role.ADMIN);
                try {
                    tx.executeWithoutResult(st -> {
                        taskService.requireById(taskId);
                        slowLoaded.countDown();
                        try {
                            assertThat(fastCommitted.await(10, TimeUnit.SECONDS)).isTrue();
                        } catch (InterruptedException e) {
                            throw new IllegalStateException(e);
                        }
                        taskService.update(taskId, new TaskService.UpdateTaskRequest(
                                        null, null, null, null, null, "并发改标题", null, null),
                                actorId, Activity.Source.WEB);
                    });
                } finally {
                    TenantContext.clear();
                }
            });

            assertThat(slowLoaded.await(10, TimeUnit.SECONDS)).isTrue();
            // 快事务：改 status 并先提交
            TenantContext.set(tenantId, Membership.Role.ADMIN);
            try {
                tx.executeWithoutResult(st -> taskService.update(taskId,
                        new TaskService.UpdateTaskRequest(Task.Status.IN_PROGRESS,
                                null, null, null, null, null, null, null),
                        actorId, Activity.Source.WEB));
            } finally {
                TenantContext.clear();
            }
            fastCommitted.countDown();

            // 慢事务提交必须冲突（旧版本快照不允许覆盖新提交）
            assertThatThrownBy(slow::get)
                    .isInstanceOf(ExecutionException.class)
                    .cause()
                    .isInstanceOf(OptimisticLockingFailureException.class);
        } finally {
            pool.shutdownNow();
        }

        // 无丢更新：快事务的 status 保留；慢事务回滚，title 仍是旧值
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT title, status FROM tasks WHERE id = ?", taskId);
        assertThat(row.get("status")).isEqualTo("IN_PROGRESS");
        assertThat(row.get("title")).isEqualTo("并发基线标题");
        // 审计与数据一致：TITLE_CHANGED 随慢事务一起回滚，不留矛盾记录
        Integer titleChanged = jdbc.queryForObject(
                "SELECT count(*) FROM activities WHERE task_id = ? AND type = 'TITLE_CHANGED'",
                Integer.class, taskId);
        assertThat(titleChanged).isZero();
    }
}

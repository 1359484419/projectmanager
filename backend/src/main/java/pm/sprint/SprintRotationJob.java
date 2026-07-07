package pm.sprint;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import pm.project.Project;
import pm.project.ProjectRepository;
import pm.tenant.TenantContext;
import pm.tenantadmin.Membership;

import java.time.LocalDate;
import java.util.Optional;

/**
 * Sprint 自动轮转 harness（每日 00:05）：遍历 auto_rotate=true 的项目，
 * 对过期 ACTIVE Sprint 循环调 SprintService.rotate 直到新 Sprint 覆盖 today。
 *
 * 幂等：无过期 ACTIVE 即 no-op，重复执行不重复建 Sprint。
 * 停机补跑：逐周期轮转补齐，每轮留下 CLOSED 记录（历史完整），
 * 未完成任务逐轮前移、最终落在当前 ACTIVE；中间周期为空 Sprint。
 * 失败隔离：按项目 try/catch，单项目异常不影响其余项目。
 *
 * 调度线程无 HTTP 请求上下文：逐项目手动设 TenantContext（供 @PrePersist 填 tenant_id），
 * 处理完清理。此线程未开 Hibernate tenantFilter，rotate 内查询均以 project/sprint id 收窄。
 */
@Component
public class SprintRotationJob {

    private static final Logger log = LoggerFactory.getLogger(SprintRotationJob.class);

    private final ProjectRepository projects;
    private final SprintService sprintService;

    public SprintRotationJob(ProjectRepository projects, SprintService sprintService) {
        this.projects = projects;
        this.sprintService = sprintService;
    }

    @Scheduled(cron = "0 5 0 * * *")
    public void run() {
        LocalDate today = pm.common.BizTime.today();
        for (Project project : projects.findByAutoRotateTrue()) {
            try {
                TenantContext.set(project.getTenantId(), Membership.Role.ADMIN);
                int rounds = 0;
                Optional<Sprint> rotated;
                while ((rotated = sprintService.rotate(project, today)).isPresent()) {
                    rounds++;
                    log.info("轮转项目 {} → 新 Sprint {}（{} ~ {}）",
                            project.getKey(), rotated.get().getName(),
                            rotated.get().getStartDate(), rotated.get().getEndDate());
                }
                if (rounds > 1) {
                    log.info("项目 {} 停机补跑：共轮转 {} 个周期到当前", project.getKey(), rounds);
                }
            } catch (Exception e) {
                log.error("项目 {} 自动轮转失败，跳过", project.getKey(), e);
            } finally {
                TenantContext.clear();
            }
        }
    }
}

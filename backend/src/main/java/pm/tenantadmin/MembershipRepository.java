package pm.tenantadmin;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/MembershipMapper.xml。
 * memberships 是租户表，但本仓库所有方法的租户条件均由调用方显式传参：
 * - findByUserId 用于 /api/me（无 TenantContext），按设计跨租户列出用户全部 membership；
 * - findByUserIdAndTenantId 被 PatAuthFilter 在无 TenantContext 时调用，tenantId 显式传入。
 * 与 JPA 现状语义一致（Membership 不继承 TenantEntity、无 Hibernate @Filter）。
 */
@Mapper
public interface MembershipRepository {

    List<Membership> findByUserId(Long userId);

    List<Membership> findByTenantId(Long tenantId);

    Optional<Membership> findByUserIdAndTenantId(@Param("userId") Long userId,
                                                 @Param("tenantId") Long tenantId);

    long countByTenantIdAndRole(@Param("tenantId") Long tenantId,
                                @Param("role") Membership.Role role);

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Membership save(Membership membership) {
        if (membership.getId() == null) {
            insert(membership);
        } else {
            update(membership);
        }
        return membership;
    }

    /** 与 JpaRepository.delete 语义一致；SQL 带 tenant_id 双重校验（值取自实体）。 */
    void delete(Membership membership);

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insert(Membership membership);

    int update(Membership membership);
}

package pm.tenantadmin;

import org.apache.ibatis.annotations.Mapper;

import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/InviteMapper.xml。
 * invites 是租户表，但 accept-invite 走 /api/auth/**（无 TenantContext），
 * findByToken 按 token（全局唯一）查、不带租户条件——与 JPA 现状一致
 * （Invite 不继承 TenantEntity、无 Hibernate @Filter），tenant_id 由上层显式使用。
 */
@Mapper
public interface InviteRepository {

    Optional<Invite> findByToken(String token);

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default Invite save(Invite invite) {
        if (invite.getId() == null) {
            insert(invite);
        } else {
            update(invite);
        }
        return invite;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insert(Invite invite);

    int update(Invite invite);
}

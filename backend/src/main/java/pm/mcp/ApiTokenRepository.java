package pm.mcp;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/ApiTokenMapper.xml。
 * api_tokens 是租户绑定表，但 PAT 是「个人资源」（/api/me 下管理，请求无 TenantContext）：
 * - findByTokenHash 全局按 hash 查（token hash 全局唯一），查到后调用方自行校验 membership——
 *   与 JPA 现状一致（ApiToken 不继承 TenantEntity、无 Hibernate @Filter）；
 * - findByUserIdOrderByIdDesc / findByIdAndUserId 按 user_id 跨租户查（个人 token 列表/删除）；
 * - deleteByUserIdAndTenantId 的 tenantId 由调用方显式传参。
 */
@Mapper
public interface ApiTokenRepository {

    Optional<ApiToken> findByTokenHash(String tokenHash);

    List<ApiToken> findByUserIdOrderByIdDesc(Long userId);

    Optional<ApiToken> findByIdAndUserId(@Param("id") Long id, @Param("userId") Long userId);

    void deleteByUserIdAndTenantId(@Param("userId") Long userId, @Param("tenantId") Long tenantId);

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default ApiToken save(ApiToken token) {
        if (token.getId() == null) {
            insert(token);
        } else {
            update(token);
        }
        return token;
    }

    /** 与 JpaRepository.delete 语义一致；SQL 带 tenant_id 双重校验（值取自实体）。 */
    void delete(ApiToken token);

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insert(ApiToken token);

    int update(ApiToken token);
}

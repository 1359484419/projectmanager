package pm.auth;

import org.apache.ibatis.annotations.Mapper;

import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/RefreshTokenMapper.xml。
 * refresh_tokens 是全局表，无租户条件。
 */
@Mapper
public interface RefreshTokenRepository {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default RefreshToken save(RefreshToken token) {
        if (token.getId() == null) {
            insert(token);
        } else {
            update(token);
        }
        return token;
    }

    /** 与 JpaRepository.delete(entity) 一致：按 id 删除。 */
    void delete(RefreshToken token);

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insert(RefreshToken token);

    int update(RefreshToken token);
}

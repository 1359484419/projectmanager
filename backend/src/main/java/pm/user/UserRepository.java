package pm.user;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper（原 JpaRepository）。SQL 在 resources/mapper/UserMapper.xml。
 * 对 Service 层暴露的方法签名与原 JpaRepository 完全一致。
 * users 是全局表，无租户条件。
 */
@Mapper
public interface UserRepository {

    Optional<User> findByEmail(String email);

    Optional<User> findById(Long id);

    /** 与 JpaRepository.findAllById 签名一致；空集合直接返回，避免 SQL IN ()。 */
    default List<User> findAllById(Iterable<Long> ids) {
        List<Long> list = new ArrayList<>();
        ids.forEach(list::add);
        if (list.isEmpty()) {
            return List.of();
        }
        return findAllByIdList(list);
    }

    /** 与 JpaRepository.save 语义一致：id 为 null 走 INSERT（回填 id），否则全字段 UPDATE。 */
    default User save(User user) {
        if (user.getId() == null) {
            insert(user);
        } else {
            update(user);
        }
        return user;
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    List<User> findAllByIdList(@Param("ids") List<Long> ids);

    void insert(User user);

    int update(User user);
}

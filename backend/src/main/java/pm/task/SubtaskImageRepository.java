package pm.task;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/**
 * MyBatis Mapper。SQL 在 resources/mapper/SubtaskImageMapper.xml。
 * subtask_images 是租户表：所有语句显式带 tenant_id = TenantContext.require()。
 */
@Mapper
public interface SubtaskImageRepository {

    default void save(SubtaskImage image) {
        insertT(image, image.getTenantId() != null ? image.getTenantId() : TenantContext.require());
    }

    default List<SubtaskImage> findMetaBySubtaskId(Long subtaskId) {
        return findMetaBySubtaskIdT(subtaskId, TenantContext.require());
    }

    default Optional<SubtaskImage> findOneById(Long id) {
        return findOneByIdT(id, TenantContext.require());
    }

    default void delete(Long id) {
        deleteByIdT(id, TenantContext.require());
    }

    // ---- 以下为 XML 里的真正语句，Service 层不直接调用 ----

    void insertT(@Param("i") SubtaskImage image, @Param("tenantId") long tenantId);

    List<SubtaskImage> findMetaBySubtaskIdT(@Param("subtaskId") Long subtaskId,
                                            @Param("tenantId") long tenantId);

    Optional<SubtaskImage> findOneByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);

    void deleteByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);
}

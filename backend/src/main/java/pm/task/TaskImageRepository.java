package pm.task;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import pm.tenant.TenantContext;

import java.util.List;
import java.util.Optional;

/** 记录图片（租户表：所有语句显式 tenant_id 条件）。 */
@Mapper
public interface TaskImageRepository {

    default void save(TaskImage image) {
        insertT(image, image.getTenantId() != null ? image.getTenantId() : TenantContext.require());
    }

    default List<TaskImage> findMetaByTaskId(Long taskId) {
        return findMetaByTaskIdT(taskId, TenantContext.require());
    }

    default Optional<TaskImage> findOneById(Long id) {
        return findOneByIdT(id, TenantContext.require());
    }

    // ---- 真正语句 ----

    @Insert("""
            INSERT INTO task_images (tenant_id, task_id, filename, content_type, data, created_at)
            VALUES (#{i.tenantId}, #{i.taskId}, #{i.filename}, #{i.contentType}, #{i.data}, #{i.createdAt})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "i.id")
    void insertT(@Param("i") TaskImage image, @Param("tenantId") long tenantId);

    /** 列表只取元数据，不拖 bytea。 */
    @Select("""
            SELECT id, tenant_id, task_id, filename, content_type, created_at
            FROM task_images
            WHERE task_id = #{taskId} AND tenant_id = #{tenantId}
            ORDER BY id ASC
            """)
    List<TaskImage> findMetaByTaskIdT(@Param("taskId") Long taskId, @Param("tenantId") long tenantId);

    @Select("""
            SELECT id, tenant_id, task_id, filename, content_type, data, created_at
            FROM task_images
            WHERE id = #{id} AND tenant_id = #{tenantId}
            """)
    Optional<TaskImage> findOneByIdT(@Param("id") Long id, @Param("tenantId") long tenantId);
}

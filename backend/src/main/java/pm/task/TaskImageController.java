package pm.task;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import pm.common.ApiException;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/** 记录图片上传/读取（仅图片类型，≤5MB/张；bytea 入库）。 */
@RestController
public class TaskImageController {

    private static final long MAX_SIZE = 5 * 1024 * 1024;
    private static final Set<String> ALLOWED = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/webp");

    private final TaskRepository tasks;
    private final TaskImageRepository images;

    public TaskImageController(TaskRepository tasks, TaskImageRepository images) {
        this.tasks = tasks;
        this.images = images;
    }

    public record ImageMeta(Long id, String filename, String contentType, Instant createdAt) {
        static ImageMeta from(TaskImage i) {
            return new ImageMeta(i.getId(), i.getFilename(), i.getContentType(), i.getCreatedAt());
        }
    }

    @PostMapping("/api/t/{slug}/tasks/{taskId}/images")
    ImageMeta upload(@PathVariable String slug, @PathVariable Long taskId,
                     @RequestParam("file") MultipartFile file) throws IOException {
        Task task = tasks.findOneById(taskId).orElseThrow(ApiException::notFound);
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED.contains(contentType)) {
            throw ApiException.badRequest("INVALID_IMAGE", "仅支持 JPEG/PNG/GIF/WebP 图片");
        }
        if (file.getSize() > MAX_SIZE) {
            throw ApiException.badRequest("IMAGE_TOO_LARGE", "图片不能超过 5MB");
        }
        TaskImage image = new TaskImage();
        image.setTaskId(task.getId());
        image.setTenantId(task.getTenantId());
        image.setFilename(file.getOriginalFilename() == null ? "image" : file.getOriginalFilename());
        image.setContentType(contentType);
        image.setData(file.getBytes());
        images.save(image);
        return ImageMeta.from(image);
    }

    @GetMapping("/api/t/{slug}/tasks/{taskId}/images")
    List<ImageMeta> list(@PathVariable String slug, @PathVariable Long taskId) {
        tasks.findOneById(taskId).orElseThrow(ApiException::notFound);
        return images.findMetaByTaskId(taskId).stream().map(ImageMeta::from).toList();
    }

    /** 图片字节流（前端 fetch + blob 展示，保持与 API 一致的鉴权）。 */
    @GetMapping("/api/t/{slug}/images/{imageId}")
    ResponseEntity<byte[]> bytes(@PathVariable String slug, @PathVariable Long imageId) {
        TaskImage image = images.findOneById(imageId).orElseThrow(ApiException::notFound);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(image.getContentType()))
                .header("Cache-Control", "private, max-age=86400")
                .body(image.getData());
    }
}

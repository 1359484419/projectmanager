package pm.task;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import pm.common.ApiException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * 子任务附件上传/读取（图片 + 常见文档，≤5MB/个；bytea 入库，与记录图片同模式）。
 * 归属校验：子任务 → 主任务经 TaskService.requireById（跨租户/他人私有 RECORD 一律 404）。
 */
@RestController
public class SubtaskImageController {

    private static final long MAX_SIZE = 5 * 1024 * 1024;
    private static final Set<String> ALLOWED = Set.of(
            // 图片
            "image/jpeg", "image/png", "image/gif", "image/webp",
            // 文档
            "application/pdf",
            "text/plain", "text/markdown", "text/csv",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/zip", "application/x-zip-compressed");

    private final SubtaskRepository subtasks;
    private final SubtaskImageRepository images;
    private final TaskService taskService;
    private final TaskRepository taskRepo;

    public SubtaskImageController(SubtaskRepository subtasks, SubtaskImageRepository images,
                                  TaskService taskService, TaskRepository taskRepo) {
        this.subtasks = subtasks;
        this.images = images;
        this.taskService = taskService;
        this.taskRepo = taskRepo;
    }

    public record ImageMeta(Long id, String filename, String contentType, Instant createdAt) {
        static ImageMeta from(SubtaskImage i) {
            return new ImageMeta(i.getId(), i.getFilename(), i.getContentType(), i.getCreatedAt());
        }
    }

    @PostMapping("/api/t/{slug}/subtasks/{subtaskId}/images")
    ImageMeta upload(@PathVariable String slug, @PathVariable Long subtaskId,
                     @RequestParam("file") MultipartFile file) throws IOException {
        Subtask subtask = requireOwned(subtaskId);
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED.contains(contentType)) {
            throw ApiException.badRequest("INVALID_ATTACHMENT",
                    "仅支持图片（JPEG/PNG/GIF/WebP）与常见文档（PDF/Office/TXT/CSV/ZIP）");
        }
        if (file.getSize() > MAX_SIZE) {
            throw ApiException.badRequest("ATTACHMENT_TOO_LARGE", "附件不能超过 5MB");
        }
        SubtaskImage image = new SubtaskImage();
        image.setSubtaskId(subtask.getId());
        image.setTenantId(subtask.getTenantId());
        image.setFilename(file.getOriginalFilename() == null ? "image" : file.getOriginalFilename());
        image.setContentType(contentType);
        image.setData(file.getBytes());
        images.save(image);
        taskRepo.touchUpdatedAt(subtask.getTaskId()); // 日报取数
        return ImageMeta.from(image);
    }

    @GetMapping("/api/t/{slug}/subtasks/{subtaskId}/images")
    List<ImageMeta> list(@PathVariable String slug, @PathVariable Long subtaskId) {
        requireOwned(subtaskId);
        return images.findMetaBySubtaskId(subtaskId).stream().map(ImageMeta::from).toList();
    }

    /**
     * 附件字节流（前端 fetch + blob 展示，保持与 API 一致的鉴权）。
     * nosniff 防浏览器按内容猜 MIME；图片 inline 展示，非图片（PDF/Office/文本等）一律 attachment 下载，
     * 不让用户上传的 HTML/SVG 类内容在本站源下被渲染执行；文件名按 RFC 5987（filename*=UTF-8''…）编码。
     */
    @GetMapping("/api/t/{slug}/subtask-images/{imageId}")
    ResponseEntity<byte[]> bytes(@PathVariable String slug, @PathVariable Long imageId) {
        SubtaskImage image = images.findOneById(imageId).orElseThrow(ApiException::notFound);
        requireOwned(image.getSubtaskId());
        boolean isImage = image.getContentType().startsWith("image/");
        String disposition = (isImage ? "inline" : "attachment")
                + "; filename*=UTF-8''" + rfc5987(image.getFilename());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(image.getContentType()))
                .header("Cache-Control", "private, max-age=86400")
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition)
                .body(image.getData());
    }

    /**
     * RFC 5987 ext-value 百分号编码：attr-char（字母数字与 !#$&+-.^_`|~）原样，其余按 UTF-8 字节 %XX。
     * 不用 Spring ContentDisposition：6.1 起会额外输出 RFC 2047 的 filename="=?UTF-8?Q?…?="，部分客户端解析异常。
     */
    static String rfc5987(String filename) {
        byte[] bytes = filename.getBytes(StandardCharsets.UTF_8);
        StringBuilder sb = new StringBuilder(bytes.length * 3);
        for (byte b : bytes) {
            char c = (char) (b & 0xff);
            boolean attrChar = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || "!#$&+-.^_`|~".indexOf(c) >= 0;
            if (attrChar) {
                sb.append(c);
            } else {
                sb.append('%').append(String.format("%02X", b & 0xff));
            }
        }
        return sb.toString();
    }

    /** 删除单个附件（传错不必删整个子任务）。 */
    @DeleteMapping("/api/t/{slug}/subtask-images/{imageId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable String slug, @PathVariable Long imageId) {
        SubtaskImage image = images.findOneById(imageId).orElseThrow(ApiException::notFound);
        Subtask subtask = requireOwned(image.getSubtaskId());
        images.delete(imageId);
        taskRepo.touchUpdatedAt(subtask.getTaskId()); // 日报取数
    }

    /** 子任务存在且主任务归属当前用户可见（跨租户/他人 RECORD → 404）。 */
    private Subtask requireOwned(Long subtaskId) {
        Subtask subtask = subtasks.findOneById(subtaskId).orElseThrow(ApiException::notFound);
        taskService.requireById(subtask.getTaskId());
        return subtask;
    }
}

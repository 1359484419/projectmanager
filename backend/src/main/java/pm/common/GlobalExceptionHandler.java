package pm.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/**
 * 统一错误体 {code, message}。
 * 业务错误走 ApiException；框架级请求错误（坏 JSON / 缺参数 / 类型不匹配 / 方法或内容类型不支持）
 * 一律映射为 4xx 中文报文，不再落到 500 INTERNAL（否则前端 toast、助手自纠与告警都拿到假 5xx）。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, String>> handleApi(ApiException e) {
        return ResponseEntity.status(e.getStatus())
                .body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }

    /** Bean Validation 失败：只取第一条字段错误的 message（注解上写中文文案）。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(f -> f.getDefaultMessage() == null || f.getDefaultMessage().isBlank()
                        ? f.getField() + " 不合法" : f.getDefaultMessage())
                .orElse("请求参数不合法");
        return badRequest(msg);
    }

    /** 请求体不是合法 JSON、字段类型不匹配（如非法枚举值）、或必需的请求体缺失。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> handleNotReadable(HttpMessageNotReadableException e) {
        return badRequest("请求体不是合法的 JSON，或字段类型/取值不正确");
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<Map<String, String>> handleMissingParam(MissingServletRequestParameterException e) {
        return badRequest("缺少必需的参数 " + e.getParameterName());
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    ResponseEntity<Map<String, String>> handleMissingPart(MissingServletRequestPartException e) {
        return badRequest("缺少必需的表单字段 " + e.getRequestPartName());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Map<String, String>> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return badRequest("参数 " + e.getName() + " 的格式不正确");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, String>> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(Map.of("code", "METHOD_NOT_ALLOWED",
                        "message", "该地址不支持 " + e.getMethod() + " 请求"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String, String>> handleMediaType(HttpMediaTypeNotSupportedException e) {
        String type = e.getContentType() == null ? "未知" : e.getContentType().toString();
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(Map.of("code", "UNSUPPORTED_MEDIA_TYPE",
                        "message", "不支持的内容类型 " + type + "，请使用 application/json"));
    }

    /**
     * 乐观锁冲突：并发编辑同一资源，后提交者 409，客户端重取后重试。
     * MyBatis 迁移后主路径由 TaskRepository.save 直接抛 ApiException.conflict（报文相同）；
     * 此 handler 保留作 Spring DAO 层（spring-jdbc/spring-tx）同类异常的兜底，409 报文不变。
     */
    @ExceptionHandler(org.springframework.dao.OptimisticLockingFailureException.class)
    ResponseEntity<Map<String, String>> handleOptimisticLock(
            org.springframework.dao.OptimisticLockingFailureException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("code", "CONFLICT",
                        "message", "资源已被他人同时修改，请刷新后重试"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, String>> handleNoResource(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("code", "NOT_FOUND", "message", "resource not found"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> handleUnknown(Exception e) {
        log.error("unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("code", "INTERNAL", "message", "internal error"));
    }

    private static ResponseEntity<Map<String, String>> badRequest(String message) {
        return ResponseEntity.badRequest().body(Map.of("code", "VALIDATION", "message", message));
    }
}

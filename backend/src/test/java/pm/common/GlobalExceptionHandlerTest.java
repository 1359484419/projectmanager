package pm.common;

import org.junit.jupiter.api.Test;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    @Test
    void optimisticLockConflict_mapsTo409Conflict() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        ResponseEntity<Map<String, String>> resp =
                handler.handleOptimisticLock(new OptimisticLockingFailureException("stale"));
        assertThat(resp.getStatusCode().value()).isEqualTo(409);
        assertThat(resp.getBody().get("code")).isEqualTo("CONFLICT");
    }

    @Test
    void frameworkExceptions_mapToClientErrorsWithChineseMessage() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var missing = handler.handleMissingParam(
                new org.springframework.web.bind.MissingServletRequestParameterException("q", "String"));
        assertThat(missing.getStatusCode().value()).isEqualTo(400);
        assertThat(missing.getBody().get("code")).isEqualTo("VALIDATION");
        assertThat(missing.getBody().get("message")).contains("q").matches(".*[\\u4e00-\\u9fff].*");

        var mismatch = handler.handleTypeMismatch(
                new org.springframework.web.method.annotation.MethodArgumentTypeMismatchException(
                        "abc", Long.class, "id", null, new NumberFormatException("abc")));
        assertThat(mismatch.getStatusCode().value()).isEqualTo(400);
        assertThat(mismatch.getBody().get("code")).isEqualTo("VALIDATION");
        assertThat(mismatch.getBody().get("message")).contains("id");

        var method = handler.handleMethodNotSupported(
                new org.springframework.web.HttpRequestMethodNotSupportedException("PUT"));
        assertThat(method.getStatusCode().value()).isEqualTo(405);
        assertThat(method.getBody().get("code")).isEqualTo("METHOD_NOT_ALLOWED");
        assertThat(method.getBody().get("message")).contains("PUT");

        var media = handler.handleMediaType(
                new org.springframework.web.HttpMediaTypeNotSupportedException("text/plain"));
        assertThat(media.getStatusCode().value()).isEqualTo(415);
        assertThat(media.getBody().get("code")).isEqualTo("UNSUPPORTED_MEDIA_TYPE");
    }
}

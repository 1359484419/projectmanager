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
}

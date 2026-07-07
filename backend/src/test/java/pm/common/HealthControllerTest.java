package pm.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import pm.IntegrationTest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class HealthControllerTest extends IntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Test
    @SuppressWarnings("unchecked")
    void health_returnsOk() {
        ResponseEntity<Map> resp = rest.getForEntity("/api/health", Map.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).isEqualTo(Map.of("status", "ok"));
    }
}

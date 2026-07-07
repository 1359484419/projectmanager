package pm.common;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 业务时区常量：燃尽图/自动轮转等「今天/日界」一律用 Asia/Shanghai，
 * 不随服务器/JVM 时区漂移。
 */
class BizTimeTest {

    @Test
    void zoneIsAsiaShanghai() {
        assertThat(BizTime.ZONE).isEqualTo(ZoneId.of("Asia/Shanghai"));
    }

    @Test
    void todayUsesBizZone() {
        assertThat(BizTime.today()).isEqualTo(LocalDate.now(ZoneId.of("Asia/Shanghai")));
    }
}

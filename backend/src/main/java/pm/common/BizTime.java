package pm.common;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * 业务时区 harness：全系统「今天/日界」统一按 Asia/Shanghai 计算，
 * 不依赖服务器/JVM 默认时区（部署环境改 UTC 也不影响燃尽图与自动轮转的日界）。
 * 业务代码禁止直接 LocalDate.now() / ZoneId.systemDefault()。
 */
public final class BizTime {

    /** 固定业务时区：Asia/Shanghai（UTC+8，无夏令时）。 */
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private BizTime() {
    }

    /** 业务时区的今天。 */
    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }
}

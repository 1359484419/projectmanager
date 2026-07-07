package pm.common;

import java.time.DayOfWeek;
import java.time.LocalDate;

/**
 * 工作日计算：闭区间内去掉周六日的天数。1 point = 1 人天的容量基准。
 */
public final class WorkdayCalculator {

    private WorkdayCalculator() {
    }

    public static int workdays(LocalDate startInclusive, LocalDate endInclusive) {
        if (startInclusive == null || endInclusive == null || endInclusive.isBefore(startInclusive)) {
            return 0;
        }
        int count = 0;
        for (LocalDate d = startInclusive; !d.isAfter(endInclusive); d = d.plusDays(1)) {
            DayOfWeek dow = d.getDayOfWeek();
            if (dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY) {
                count++;
            }
        }
        return count;
    }
}

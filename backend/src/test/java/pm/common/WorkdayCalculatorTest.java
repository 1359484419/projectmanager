package pm.common;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 工作日计算（去周六日，闭区间）。
 */
class WorkdayCalculatorTest {

    @Test
    void twoWeeks_mondayToFriday_is10() {
        // 2026-07-06 是周一，2026-07-17 是周五
        assertThat(WorkdayCalculator.workdays(
                LocalDate.of(2026, 7, 6), LocalDate.of(2026, 7, 17))).isEqualTo(10);
    }

    @Test
    void singleWeek_crossingWeekend_is5() {
        // 2026-07-06(一) ~ 2026-07-12(日)：跨一个周末仍是 5 个工作日
        assertThat(WorkdayCalculator.workdays(
                LocalDate.of(2026, 7, 6), LocalDate.of(2026, 7, 12))).isEqualTo(5);
    }

    @Test
    void weekendOnly_is0() {
        assertThat(WorkdayCalculator.workdays(
                LocalDate.of(2026, 7, 11), LocalDate.of(2026, 7, 12))).isEqualTo(0);
    }

    @Test
    void singleWorkday_is1() {
        assertThat(WorkdayCalculator.workdays(
                LocalDate.of(2026, 7, 6), LocalDate.of(2026, 7, 6))).isEqualTo(1);
    }

    @Test
    void monthLikeRange_countsActualWorkdays() {
        // 2026-07-01(三) ~ 2026-07-31(五)：23 个工作日
        assertThat(WorkdayCalculator.workdays(
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31))).isEqualTo(23);
    }
}

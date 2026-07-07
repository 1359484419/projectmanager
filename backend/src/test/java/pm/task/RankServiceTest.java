package pm.task;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 字典序中点算法纯单测：字符集 0-9a-z。
 */
class RankServiceTest {

    RankService rank = new RankService();

    @Test
    void fixedPoints() {
        assertThat(rank.between(null, null)).isEqualTo("i");
        assertThat(rank.between("i", null)).isEqualTo("r");
        assertThat(rank.between("a", "b")).isEqualTo("am");
    }

    @Test
    void orderingProperty_betweenTwo() {
        String[][] pairs = {
                {"a", "b"}, {"i", "r"}, {"0", "z"}, {"am", "an"}, {"a", "a1"},
                {"az", "b"}, {"i", "i1"}, {"x", "x000001"}, {"5", "6"}, {"zz", "zzz"},
        };
        for (String[] p : pairs) {
            String mid = rank.between(p[0], p[1]);
            assertThat(mid).as("between(%s,%s)", p[0], p[1])
                    .isGreaterThan(p[0]).isLessThan(p[1]);
        }
    }

    @Test
    void orderingProperty_openEnds() {
        // 尾插链：每次 between(last, null) 必须严格递增
        String last = rank.between(null, null);
        for (int i = 0; i < 50; i++) {
            String next = rank.between(last, null);
            assertThat(next).as("after %s", last).isGreaterThan(last);
            last = next;
        }
        // 头插链：每次 between(null, first) 必须严格递减
        String first = rank.between(null, null);
        for (int i = 0; i < 50; i++) {
            String prev = rank.between(null, first);
            assertThat(prev).as("before %s", first).isLessThan(first);
            first = prev;
        }
    }

    @Test
    void orderingProperty_repeatedBisection() {
        // 在同一对之间反复取中点，模拟高频拖拽
        String lo = "a";
        String hi = "b";
        for (int i = 0; i < 50; i++) {
            String mid = rank.between(lo, hi);
            assertThat(mid).isGreaterThan(lo).isLessThan(hi);
            if (i % 2 == 0) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
    }

    @Test
    void invalidOrder_throws() {
        assertThatThrownBy(() -> rank.between("b", "a")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> rank.between("a", "a")).isInstanceOf(IllegalArgumentException.class);
    }
}

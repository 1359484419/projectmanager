package pm.task;

import org.springframework.stereotype.Service;

/**
 * 字典序排序键中点算法（字符集 0-9a-z，36 进制）。
 * 约定：生成的 rank 永不以 '0' 结尾，保证任意两个已生成 rank 之间总能再插入。
 * 固定点：between(null,null)="i"，between("i",null)="r"，between("a","b")="am"。
 */
@Service
public class RankService {

    static final String DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
    static final int BASE = 36;

    /**
     * 返回严格介于 a 与 b 之间的 rank。a=null 表示负无穷（头插），b=null 表示正无穷（尾插）。
     */
    public String between(String a, String b) {
        String lo = a == null ? "" : a;
        if (b == null) {
            return lo.isEmpty() ? "i" : after(lo);
        }
        if (lo.compareTo(b) >= 0) {
            throw new IllegalArgumentException("rank order violated: " + lo + " >= " + b);
        }
        return mid(lo, b);
    }

    /** 尾插：取比 a 首位更靠后的单字符；a 以 'z' 开头时追加 "i"。 */
    private String after(String a) {
        int d = val(a.charAt(0));
        int m = (d + BASE) / 2;
        if (m > d) {
            return String.valueOf(DIGITS.charAt(m));
        }
        return a + "i";
    }

    private String mid(String a, String b) {
        StringBuilder prefix = new StringBuilder();
        for (int i = 0; i < b.length(); i++) {
            int da = i < a.length() ? val(a.charAt(i)) : 0;
            int db = val(b.charAt(i));
            if (da == db) {
                prefix.append(b.charAt(i));
                continue;
            }
            if (db - da >= 2) {
                return prefix.append(DIGITS.charAt((da + db) / 2)).toString();
            }
            // 相邻：取 a 的该位，再在 a 的剩余后缀之后追加
            prefix.append(DIGITS.charAt(da));
            String rest = i < a.length() ? a.substring(i + 1) : "";
            return prefix.append(rest.isEmpty() ? "m" : after(rest)).toString();
        }
        // 仅当 b = a前缀 + "0"* 时到达（正常生成的 rank 不含尾部 '0'）
        throw new IllegalArgumentException("no rank fits between " + a + " and " + b);
    }

    private int val(char c) {
        int v = DIGITS.indexOf(c);
        if (v < 0) {
            throw new IllegalArgumentException("invalid rank char: " + c);
        }
        return v;
    }
}

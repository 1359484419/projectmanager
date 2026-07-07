package pm.common;

/**
 * 文本字段长度上限（REST 与 MCP 共用，超限 400 VALIDATION，中文文案）。
 */
public final class FieldLimits {

    public static final int TASK_TITLE = 200;
    public static final int TASK_DESCRIPTION = 10000;
    public static final int PROJECT_NAME = 100;
    public static final int EPIC_NAME = 100;
    public static final int EPIC_DESCRIPTION = 2000;
    public static final int COMMENT_BODY = 5000;

    private FieldLimits() {
    }

    /** value 为 null 放行（是否必填由调用方判定）；超过 max → 400 VALIDATION。 */
    public static void check(String value, int max, String fieldLabel) {
        if (value != null && value.length() > max) {
            throw ApiException.badRequest("VALIDATION",
                    fieldLabel + "长度不能超过 " + max + " 字符（当前 " + value.length() + "）");
        }
    }
}

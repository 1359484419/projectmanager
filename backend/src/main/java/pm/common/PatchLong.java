package pm.common;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

/**
 * PATCH 三态字段（Long）：字段缺省 → 引用为 null（不改）；
 * 显式传 null → PatchLong(null)（置空）；传值 → PatchLong(v)。
 * 注意不能用 Optional：Jackson 对缺省的 Optional 构造参数给 Optional.empty()，与显式 null 无法区分。
 */
@JsonDeserialize(using = PatchLong.Deser.class)
public record PatchLong(Long value) {

    public static class Deser extends JsonDeserializer<PatchLong> {
        @Override
        public PatchLong deserialize(JsonParser p, DeserializationContext ctx)
                throws java.io.IOException {
            return new PatchLong(p.getLongValue());
        }

        @Override
        public PatchLong getNullValue(DeserializationContext ctx) {
            return new PatchLong(null);
        }

        /** 字段缺省时 Jackson 走 absentValue（默认委托 nullValue）——必须区分：缺省 = null 引用（不改）。 */
        @Override
        public Object getAbsentValue(DeserializationContext ctx) {
            return null;
        }
    }
}

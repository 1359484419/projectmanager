package pm.common;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

/**
 * PATCH 三态字段（String）：字段缺省 → 引用为 null（不改）；
 * 显式传 null → PatchString(null)（置空）；传值 → PatchString(v)。
 * 与 {@link PatchLong} 同一思路：不能用 Optional（缺省与显式 null 无法区分）。
 */
@JsonDeserialize(using = PatchString.Deser.class)
public record PatchString(String value) {

    public static class Deser extends JsonDeserializer<PatchString> {
        @Override
        public PatchString deserialize(JsonParser p, DeserializationContext ctx)
                throws java.io.IOException {
            return new PatchString(p.getValueAsString());
        }

        @Override
        public PatchString getNullValue(DeserializationContext ctx) {
            return new PatchString(null);
        }

        /** 字段缺省时 Jackson 走 absentValue（默认委托 nullValue）——必须区分：缺省 = null 引用（不改）。 */
        @Override
        public Object getAbsentValue(DeserializationContext ctx) {
            return null;
        }
    }
}

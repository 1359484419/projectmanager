"""MCP 子应用：把工具目录（tool_guard.REGISTRY）的精选子集以 MCP（无状态 Streamable HTTP）暴露给外部 agent。

与面板助手的差异：没有确认卡 → L3 工具要求 confirm:true + destructiveHint；没有面板当前项目 → 参数里显式给 project_key；
租户/用户只来自 Java 反代注入的 X-PM-* 头（PAT 已在 Java 侧校验），输出经 _wire 清洗，绝不出内部 id。
"""

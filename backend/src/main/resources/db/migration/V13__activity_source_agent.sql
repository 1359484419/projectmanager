-- 活动来源新增 AGENT（自然语言助手）。
-- 列内 CHECK 约束由 PG 自动命名为 activities_source_check；放宽为三值。
-- 回滚到旧 jar 时已写入的 AGENT 行仍在（旧枚举无此值），属回滚已知限制。
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE activities ADD CONSTRAINT activities_source_check CHECK (source IN ('WEB','MCP','AGENT'));

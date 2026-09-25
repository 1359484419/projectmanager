-- 运行级观测标记（评审 2026-09-25）：UNVERIFIED_NEGATIVE_CLAIM（未调工具却说不存在）/ CREATE_THEN_DELETE:<tool>:<key>（同次运行创建后紧接删除）。
-- 幂等：可重复执行。
ALTER TABLE agent.runs ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb;

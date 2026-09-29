-- V15: 子任务排序 rank（字典序中点，与 tasks.rank 同算法）+ 完成留痕 done_at/done_by
-- 存量数据回填：'b' + 10 位零填充 id，字典序 == id 升序（保持原有排列）；宽度内 id 永不越界
ALTER TABLE subtasks ADD COLUMN rank TEXT;
UPDATE subtasks SET rank = 'b' || lpad(id::text, 10, '0');
ALTER TABLE subtasks ALTER COLUMN rank SET NOT NULL;

ALTER TABLE subtasks ADD COLUMN done_at TIMESTAMPTZ;
ALTER TABLE subtasks ADD COLUMN done_by BIGINT;

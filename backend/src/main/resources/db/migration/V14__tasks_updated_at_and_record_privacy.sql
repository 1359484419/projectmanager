-- V14: tasks.updated_at（日报按「今天改过的任务」取数）+ 记录私有性数据修复 + 邮箱归一化
-- 1) updated_at：新列带默认值；存量行回填为 created_at / done_at / 最近一条 activity 中的最大值
ALTER TABLE tasks ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE tasks t
SET updated_at = GREATEST(
        t.created_at,
        COALESCE(t.done_at, t.created_at),
        COALESCE((SELECT max(a.at) FROM activities a WHERE a.task_id = t.id), t.created_at));

-- 2) 记录（RECORD）是创建者私有数据：历史上挂进迭代/Epic/指派过的记录一律解除关联
UPDATE tasks
SET sprint_id = NULL, epic_id = NULL, assignee_id = NULL
WHERE type = 'RECORD'
  AND (sprint_id IS NOT NULL OR epic_id IS NOT NULL OR assignee_id IS NOT NULL);

-- 3) 邮箱归一化为小写（应用层从此只写/查小写）；若小写后与另一账号撞车则保留原样，由管理员人工合并
UPDATE users u
SET email = lower(u.email)
WHERE u.email <> lower(u.email)
  AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id <> u.id AND o.email = lower(u.email));

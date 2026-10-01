-- V17: tasks.status_changed_at（日报「今日完成」取数：done_at 只在 DONE 时有值，updated_at 任何编辑都会变）
-- 新列先允许 NULL，存量回填 = 该任务最近一条 STATUS_CHANGED activity 的 at，没有则 created_at，再收紧 NOT NULL
ALTER TABLE tasks ADD COLUMN status_changed_at TIMESTAMPTZ;
UPDATE tasks t
SET status_changed_at = COALESCE(
        (SELECT max(a.at) FROM activities a WHERE a.task_id = t.id AND a.type = 'STATUS_CHANGED'),
        t.created_at);
ALTER TABLE tasks ALTER COLUMN status_changed_at SET NOT NULL;

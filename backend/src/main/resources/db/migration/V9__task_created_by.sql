-- 任务增加创建者字段；存量数据从 activity 表的 CREATED 记录回填
ALTER TABLE tasks ADD COLUMN created_by BIGINT;

UPDATE tasks t
SET created_by = (
    SELECT a.actor_id FROM activities a
    WHERE a.task_id = t.id AND a.type = 'CREATED'
    LIMIT 1
);

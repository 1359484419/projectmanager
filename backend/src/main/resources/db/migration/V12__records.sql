-- 记录模块：任务类型 RECORD（内容/图片 + 可选提醒），提醒到期右上角弹框，手动关闭后不再弹
ALTER TABLE tasks DROP CONSTRAINT tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check CHECK (type IN ('STORY','BUG','TASK','RECORD'));

ALTER TABLE tasks ADD COLUMN remind_at timestamptz;
ALTER TABLE tasks ADD COLUMN reminder_dismissed boolean NOT NULL DEFAULT false;

-- 到期提醒轮询走这个部分索引（未关闭且设置了提醒的记录）
CREATE INDEX idx_tasks_due_reminders ON tasks (tenant_id, remind_at)
    WHERE remind_at IS NOT NULL AND NOT reminder_dismissed;

-- 记录图片：bytea 入库（单机小团队量级，与 DB 备份一致；上传限 5MB/张）
CREATE TABLE task_images (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT      NOT NULL,
    task_id      BIGINT      NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_images_task ON task_images (task_id);

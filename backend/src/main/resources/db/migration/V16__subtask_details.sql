-- 子任务详情：描述 / 负责人 / 到期日 + 图片附件（bytea 入库，与 task_images 同模式）
ALTER TABLE subtasks ADD COLUMN description TEXT;
ALTER TABLE subtasks ADD COLUMN assignee_id BIGINT;
ALTER TABLE subtasks ADD COLUMN due_date DATE;

-- 子任务图片：级联随子任务删除（子任务本身由 TaskService.delete 清理）
CREATE TABLE subtask_images (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT      NOT NULL,
    subtask_id   BIGINT      NOT NULL REFERENCES subtasks (id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subtask_images_subtask ON subtask_images (subtask_id);

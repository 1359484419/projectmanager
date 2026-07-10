-- V10: 子任务（仅挂在主任务下，两态 done，不进列表/看板）
CREATE TABLE subtasks (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL,
    task_id    BIGINT NOT NULL,
    title      TEXT NOT NULL,
    done       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subtasks_tenant_task ON subtasks(tenant_id, task_id);

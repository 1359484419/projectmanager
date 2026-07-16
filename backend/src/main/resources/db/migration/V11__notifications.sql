-- V11: notifications 表（消息中心：任务指派通知）。
-- 触发：任务创建时带 assignee、或 assignee 变更，且新 assignee ≠ 操作者本人。
-- read_at NULL = 未读；标已读只在通知下拉里发生（点击该条或"全部已读"）。

CREATE TABLE notifications (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
    user_id    BIGINT NOT NULL REFERENCES users(id),
    task_id    BIGINT NOT NULL REFERENCES tasks(id),
    type       TEXT NOT NULL DEFAULT 'TASK_ASSIGNED' CHECK (type IN ('TASK_ASSIGNED')),
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 轮询主查询：某用户最近通知 / 未读数
CREATE INDEX idx_notifications_user ON notifications(tenant_id, user_id, id DESC);
-- 任务/项目级联删除用
CREATE INDEX idx_notifications_task ON notifications(task_id);

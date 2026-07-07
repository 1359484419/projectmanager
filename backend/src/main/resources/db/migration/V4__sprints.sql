-- V4: sprints + capacity_overrides；补 tasks.sprint_id 外键；
--     activities.actor_id 允许 NULL（系统动作：自动轮转 job）。

CREATE TABLE sprints (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
    project_id BIGINT NOT NULL REFERENCES projects(id),
    name       TEXT NOT NULL,
    length     TEXT NOT NULL CHECK (length IN ('WEEK_1','WEEK_2','MONTH_1')),
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    status     TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

-- 同项目最多一个 ACTIVE Sprint（部分唯一索引兜底并发）
CREATE UNIQUE INDEX one_active_sprint ON sprints(project_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_sprints_project ON sprints(project_id);

ALTER TABLE tasks
    ADD CONSTRAINT fk_tasks_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(id);

CREATE TABLE capacity_overrides (
    id        BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    sprint_id BIGINT NOT NULL REFERENCES sprints(id),
    user_id   BIGINT NOT NULL REFERENCES users(id),
    capacity  INT NOT NULL CHECK (capacity >= 0),
    UNIQUE (sprint_id, user_id)
);

-- 自动轮转 job 写的 SPRINT_CHANGED 没有人类 actor：actor_id NULL = 系统
ALTER TABLE activities ALTER COLUMN actor_id DROP NOT NULL;

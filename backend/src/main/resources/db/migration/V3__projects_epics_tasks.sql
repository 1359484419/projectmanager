-- V3: 核心域五表：projects / epics / tasks / comments / activities
-- 注：tasks.sprint_id 的外键在 V4 建 sprints 表后补加。

CREATE TABLE projects (
    id                    BIGSERIAL PRIMARY KEY,
    tenant_id             BIGINT NOT NULL REFERENCES tenants(id),
    key                   TEXT NOT NULL CHECK (key ~ '^[A-Z]{2,6}$'),
    name                  TEXT NOT NULL,
    default_sprint_length TEXT NOT NULL DEFAULT 'WEEK_2'
                          CHECK (default_sprint_length IN ('WEEK_1','WEEK_2','MONTH_1')),
    auto_rotate           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE epics (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
    project_id  BIGINT NOT NULL REFERENCES projects(id),
    name        TEXT NOT NULL,
    description TEXT,
    quarter     TEXT CHECK (quarter ~ '^\d{4}-Q[1-4]$'),
    color       TEXT,
    status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE'))
);

CREATE TABLE tasks (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
    project_id  BIGINT NOT NULL REFERENCES projects(id),
    sprint_id   BIGINT,                       -- NULL = Backlog；FK 于 V4 补
    epic_id     BIGINT REFERENCES epics(id),
    type        TEXT NOT NULL CHECK (type IN ('STORY','BUG','TASK')),
    seq         INT  NOT NULL,                -- 项目内自增展示号（PM-42）
    title       TEXT NOT NULL,
    description TEXT,
    points      INT CHECK (points > 0),       -- 1 point = 1 人天
    assignee_id BIGINT REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'TODO'
                CHECK (status IN ('TODO','IN_PROGRESS','COMPLETED','DONE')),
    rank        TEXT NOT NULL,                -- 字典序排序键
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    done_at     TIMESTAMPTZ,                  -- 进入 DONE 写入，回退清空
    UNIQUE (project_id, seq)
);

CREATE TABLE comments (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
    task_id    BIGINT NOT NULL REFERENCES tasks(id),
    author_id  BIGINT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activities (
    id        BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    task_id   BIGINT NOT NULL REFERENCES tasks(id),
    actor_id  BIGINT NOT NULL REFERENCES users(id),
    type      TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source    TEXT NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','MCP')),
    at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_tenant   ON projects(tenant_id);
CREATE INDEX idx_epics_project     ON epics(project_id);
CREATE INDEX idx_tasks_project     ON tasks(project_id, rank);
CREATE INDEX idx_tasks_sprint      ON tasks(sprint_id);
CREATE INDEX idx_tasks_epic        ON tasks(epic_id);
CREATE INDEX idx_comments_task     ON comments(task_id);
CREATE INDEX idx_activities_task   ON activities(task_id, at DESC);

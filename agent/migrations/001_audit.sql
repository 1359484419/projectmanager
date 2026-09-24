-- 智能体审计表（schema agent 由 Python 自管，Flyway 不碰）。幂等：可重复执行。
CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.runs (
    run_id       text PRIMARY KEY,
    thread_id    text NOT NULL,
    tenant_slug  text NOT NULL,
    user_id      bigint NOT NULL,
    input_text   text NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz,
    status       text,                 -- ok | error | interrupted
    tokens       integer,
    error_code   text
);
CREATE INDEX IF NOT EXISTS runs_thread_idx ON agent.runs (thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_tenant_user_idx ON agent.runs (tenant_slug, user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent.tool_calls (
    id           bigserial PRIMARY KEY,
    run_id       text NOT NULL,
    call_id      text NOT NULL,
    tool         text NOT NULL,
    risk         text NOT NULL,
    args         jsonb NOT NULL DEFAULT '{}'::jsonb,
    decision     text NOT NULL DEFAULT 'none',   -- approve | edit | reject | none
    decided_at   timestamptz NOT NULL DEFAULT now(),
    http_status  integer,
    summary      text,
    ms           integer
);
CREATE INDEX IF NOT EXISTS tool_calls_run_idx ON agent.tool_calls (run_id);

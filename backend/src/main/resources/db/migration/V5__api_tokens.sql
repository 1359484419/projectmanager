-- V5: 个人访问令牌（PAT），供 MCP / 脚本用；库存 SHA-256 hash，明文只在创建时返回一次。
CREATE TABLE api_tokens (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
    user_id      BIGINT NOT NULL REFERENCES users(id),
    token_hash   TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- V2: 邀请链接
CREATE TABLE invites (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
    token      TEXT NOT NULL UNIQUE,
    role       TEXT NOT NULL CHECK (role IN ('ADMIN','MEMBER')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_invites_tenant ON invites(tenant_id);

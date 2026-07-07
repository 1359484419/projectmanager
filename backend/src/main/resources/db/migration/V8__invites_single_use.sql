-- V8: 邀请一次性消费标记。
-- accept 成功即写 used_at/used_by；再次使用同一 token → 410 INVITE_USED。
-- 堵住「被踢成员拿旧邀请链接自助重新加入」的绕过路径（链接不再无限次可用）。
ALTER TABLE invites ADD COLUMN used_at TIMESTAMPTZ;
ALTER TABLE invites ADD COLUMN used_by BIGINT REFERENCES users(id);

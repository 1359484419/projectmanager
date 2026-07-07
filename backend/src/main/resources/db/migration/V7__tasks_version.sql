-- V7: tasks 乐观锁版本列（@Version）。
-- 并发 PATCH 同一任务不同字段时，后提交的旧快照事务冲突失败（REST 层转 409），
-- 杜绝全字段 UPDATE 覆盖他人已提交变更导致的丢更新与审计矛盾。
ALTER TABLE tasks ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

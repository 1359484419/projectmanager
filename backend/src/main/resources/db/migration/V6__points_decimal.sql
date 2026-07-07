-- V6: points 支持 0.5-5 小数（numeric(2,1)，如 0.5 / 1 / 1.5 … 5）。
-- 存量越界值先归一化（幂等；在 ALTER 前执行，避免 >9.9 的历史值转 numeric(2,1) 溢出）。
UPDATE tasks SET points = 5 WHERE points > 5;
UPDATE tasks SET points = NULL WHERE points <= 0;

ALTER TABLE tasks ALTER COLUMN points TYPE numeric(2,1);

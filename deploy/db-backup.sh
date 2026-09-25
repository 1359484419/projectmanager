#!/usr/bin/env bash
# 每日数据库备份（由 systemd timer pm-db-backup.timer 触发，以 postgres 用户运行）。
# pg_dump -Fc（自定义压缩格式，pg_restore 可选表/并行恢复）→ /opt/pm/backups/db/pm-<时间戳>.dump
# 保留 14 天；写入先落 .part 再原子改名，避免半截文件被当成有效备份。
# 幂等：同一分钟重复执行只会覆盖同名文件；不会触碰其它库。
set -euo pipefail

DB_NAME=${PM_DB_NAME:-pm}
BACKUP_DIR=${PM_BACKUP_DIR:-/opt/pm/backups/db}
KEEP_DAYS=${PM_BACKUP_KEEP_DAYS:-14}

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M)
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

pg_dump -Fc --no-owner --dbname="$DB_NAME" --file="$OUT.part"
mv -f "$OUT.part" "$OUT"
chmod 600 "$OUT"

# 保留策略：删除 KEEP_DAYS 天前的备份（只删本脚本命名规则的文件）
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.dump" -mtime +"$KEEP_DAYS" -delete
rm -f "$BACKUP_DIR"/${DB_NAME}-*.dump.part

SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.dump" | wc -l)
echo "pm-db-backup: $OUT ($SIZE)，当前保留 $COUNT 份（$KEEP_DAYS 天）"

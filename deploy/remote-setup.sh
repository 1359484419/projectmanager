#!/usr/bin/env bash
# 服务器端一次性/幂等初始化脚本（在目标服务器上以 sudo 运行）。
# 前提：Ubuntu 24.04，已有 PostgreSQL 16 本地实例（绝不触碰已有库/数据）。
# 幂等：重复运行不会破坏已有部署；已存在的 pm 库/用户/env/unit 均跳过。
# 用法：sudo bash remote-setup.sh
set -euo pipefail

echo "==> 1. Java 21 运行时（已装则跳过）"
if ! command -v java >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless
fi
java -version 2>&1 | head -1

echo "==> 2. 系统用户 pm（已存在则跳过）"
id pm >/dev/null 2>&1 || useradd --system --home-dir /opt/pm --shell /usr/sbin/nologin pm

echo "==> 3. 目录 /opt/pm"
mkdir -p /opt/pm/backups
# 注意：不递归 chown，避免幂等重跑时覆盖 /opt/pm/env 的 root:root 属主
chown pm:pm /opt/pm /opt/pm/backups

echo "==> 4. PostgreSQL：独立的 pm 用户与 pm 库（幂等，不动任何已有库）"
DB_PASS_FILE=/opt/pm/.dbpass
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='pm'" | grep -q 1; then
  DB_PASS=$(openssl rand -hex 16)
  echo "$DB_PASS" > "$DB_PASS_FILE"; chmod 600 "$DB_PASS_FILE"; chown root:root "$DB_PASS_FILE"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE pm LOGIN PASSWORD '$DB_PASS'"
else
  echo "  role pm 已存在，跳过"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pm'" | grep -q 1; then
  sudo -u postgres createdb -O pm pm
else
  echo "  database pm 已存在，跳过"
fi

echo "==> 5. /opt/pm/env（已存在则保留不覆盖）"
if [ ! -f /opt/pm/env ]; then
  if [ ! -f "$DB_PASS_FILE" ]; then
    echo "错误：/opt/pm/env 不存在且找不到 $DB_PASS_FILE（pm 角色已存在但密码未知）。" >&2
    echo "请手动 ALTER ROLE pm PASSWORD 后自行写 /opt/pm/env。" >&2
    exit 1
  fi
  JWT_SECRET=$(openssl rand -hex 32)
  cat > /opt/pm/env <<EOF
DB_URL=jdbc:postgresql://127.0.0.1:5432/pm
DB_USER=pm
DB_PASS=$(cat "$DB_PASS_FILE")
JWT_SECRET=$JWT_SECRET
EOF
  chmod 600 /opt/pm/env
  chown root:root /opt/pm/env
else
  echo "  /opt/pm/env 已存在，保留"
fi
# env 就位后临时密码文件即可删除
rm -f "$DB_PASS_FILE"

echo "==> 6. systemd unit（与仓库 deploy/pm.service 同步）"
cp "$(dirname "$0")/pm.service" /etc/systemd/system/pm.service
# EnvironmentFile 为 root:600，pm 用户进程由 systemd 注入环境，无需读该文件
systemctl daemon-reload

echo "==> 初始化完成。下一步：上传 app.jar 到 /opt/pm/ 并 systemctl enable --now pm"

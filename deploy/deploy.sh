#!/usr/bin/env bash
# 从本机部署到目标服务器（jar 已由 deploy/build.sh 产出）。
# 用法：PM_HOST=user@host ./deploy/deploy.sh
#   SSH 认证方式自理（推荐密钥；密码可用 sshpass -e + SSHPASS 环境变量，绝不写入文件/日志）。
# 幂等：旧 jar 自动备份到 /opt/pm/backups/，重复执行安全。
set -euo pipefail

: "${PM_HOST:?用法: PM_HOST=user@host ./deploy/deploy.sh}"
SSH=${PM_SSH:-ssh}   # 可注入 "sshpass -e ssh"
SCP=${PM_SCP:-scp}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAR=$(ls -t "$ROOT"/backend/target/projectmanager-*.jar | head -1)
[ -f "$JAR" ] || { echo "未找到 jar，先跑 deploy/build.sh"; exit 1; }
AGENT_TGZ="$ROOT/backend/target/pm-agent.tgz"
[ -f "$AGENT_TGZ" ] || { echo "未找到 pm-agent.tgz，先跑 deploy/build.sh"; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S)

echo "==> 上传初始化脚本与 unit"
$SCP "$ROOT/deploy/remote-setup.sh" "$ROOT/deploy/pm.service" "$ROOT/deploy/pm-agent.service" "$PM_HOST:/tmp/"
$SSH "$PM_HOST" "sudo bash -c 'mkdir -p /opt/pm && mv /tmp/remote-setup.sh /tmp/pm.service /tmp/pm-agent.service /opt/pm/ && bash /opt/pm/remote-setup.sh'"

echo "==> 备份旧 jar 并上传新 jar: ${JAR}"
$SSH "$PM_HOST" "sudo bash -c '[ -f /opt/pm/app.jar ] && cp /opt/pm/app.jar /opt/pm/backups/app-$STAMP.jar || true'"
$SCP "$JAR" "$PM_HOST:/tmp/app.jar"
$SSH "$PM_HOST" "sudo bash -c 'mv /tmp/app.jar /opt/pm/app.jar && chown pm:pm /opt/pm/app.jar'"

echo "==> 启动/重启服务"
$SSH "$PM_HOST" "sudo systemctl enable pm >/dev/null 2>&1; sudo systemctl restart pm"

echo "==> 等待健康检查"
ok=0
for i in $(seq 1 30); do
  if $SSH "$PM_HOST" "curl -sf http://localhost:8080/api/health" 2>/dev/null | grep -q ok; then
    echo "健康检查通过"; ok=1; break
  fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "健康检查超时，查看日志：$SSH $PM_HOST 'sudo journalctl -u pm -n 100'" >&2; exit 1; }

echo "==> 智能体服务：上传源码包，uv sync --frozen（以 pm 用户，venv 与缓存都在 /opt/pm-agent 下）"
$SCP "$AGENT_TGZ" "$PM_HOST:/tmp/pm-agent.tgz"
$SSH "$PM_HOST" "sudo bash -c '
  set -e
  rm -rf /opt/pm-agent/app /opt/pm-agent/migrations
  tar xzf /tmp/pm-agent.tgz -C /opt/pm-agent && rm -f /tmp/pm-agent.tgz
  chown -R pm:pm /opt/pm-agent/app /opt/pm-agent/migrations /opt/pm-agent/pyproject.toml /opt/pm-agent/uv.lock
  cd /opt/pm-agent
  sudo -u pm env HOME=/opt/pm-agent UV_CACHE_DIR=/opt/pm-agent/.cache/uv UV_PYTHON_INSTALL_DIR=/opt/pm-agent/.python \\
    /usr/local/bin/uv sync --frozen --no-dev
'"

echo "==> 启动/重启 pm-agent"
$SSH "$PM_HOST" "sudo systemctl enable pm-agent >/dev/null 2>&1; sudo systemctl restart pm-agent"
for i in $(seq 1 20); do
  body=$($SSH "$PM_HOST" "curl -s http://127.0.0.1:8090/health" 2>/dev/null || true)
  if echo "$body" | grep -q '"status"'; then
    echo "pm-agent 健康检查：$body"
    echo "$body" | grep -q '"llm":"ok"' || echo "提示：模型网关不可达，请检查 /opt/pm-agent/env 的 LLM_BASE_URL / LLM_API_KEY 后 systemctl restart pm-agent" >&2
    exit 0
  fi
  sleep 2
done
echo "pm-agent 健康检查超时，查看日志：$SSH $PM_HOST 'sudo journalctl -u pm-agent -n 100'" >&2
exit 1

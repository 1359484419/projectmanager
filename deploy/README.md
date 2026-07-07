# 部署（单机 systemd + fat jar，无域名直连 8080）

目标形态：本地打 fat jar（前端 `dist/` 打入 Spring Boot `static/`，SPA fallback 已内置）→ scp 到服务器 `/opt/pm/app.jar` → systemd 托管，环境变量经 `/opt/pm/env`（600）注入。复用服务器已有 PostgreSQL 实例，但使用**独立的** `pm` 库与 `pm` 用户，不触碰其他库。

## 前置条件

- 本机：JDK 21、Maven、Node 20+、ssh/scp（密码登录可配 sshpass）
- 服务器：Ubuntu 22.04+/24.04，PostgreSQL 16 本地实例，sudo 权限；脚本会自动安装 `openjdk-21-jre-headless`
- 安全组/防火墙需放行 TCP 8080（无域名，直接 http）

## 步骤

```bash
# 1. 构建（前端 build + 打包 fat jar）
./deploy/build.sh

# 2. 部署（幂等：初始化 + 上传 + 重启 + 健康检查）
PM_HOST=ubuntu@<服务器IP> ./deploy/deploy.sh
# 密码登录示例（凭证只走环境变量，不落文件）：
#   read -s SSHPASS && export SSHPASS
#   PM_HOST=ubuntu@<IP> PM_SSH="sshpass -e ssh" PM_SCP="sshpass -e scp" ./deploy/deploy.sh

# 3. 验证
curl http://<服务器IP>:8080/api/health   # → {"status":"ok"}
```

`remote-setup.sh`（deploy.sh 自动执行）做的事，全部幂等：

1. 安装 Java 21 JRE（已装跳过）
2. 建系统用户 `pm` 与目录 `/opt/pm`（含 `backups/`）
3. 在已有 PG 实例上建独立 `pm` 角色（随机密码）与 `pm` 库（已存在跳过，绝不动其他库）
4. 生成 `/opt/pm/env`（`DB_URL/DB_USER/DB_PASS/JWT_SECRET`，secret 用 `openssl rand` 生成，权限 600，已存在则保留）
5. 安装 `pm.service`（模板见本目录）

## 环境变量（/opt/pm/env）

| 变量 | 说明 |
|------|------|
| `DB_URL` | `jdbc:postgresql://127.0.0.1:5432/pm` |
| `DB_USER` / `DB_PASS` | 独立 pm 库用户（setup 随机生成） |
| `JWT_SECRET` | HS256 密钥，≥32 字节，`openssl rand -hex 32` |

模板见 `env.example`。真实值只存在于服务器 `/opt/pm/env`，绝不提交仓库。

## 运维

```bash
sudo systemctl status pm            # 状态
sudo journalctl -u pm -f            # 日志
sudo systemctl restart pm           # 重启
```

## 回滚

旧 jar 每次部署自动备份到 `/opt/pm/backups/app-<时间戳>.jar`：

```bash
sudo systemctl stop pm
sudo cp /opt/pm/backups/app-<时间戳>.jar /opt/pm/app.jar
sudo systemctl start pm
```

DB 迁移由 Flyway 前向管理；回滚到旧 jar 若跨过新增迁移，需确认新迁移向后兼容（本项目迁移均为增量建表，兼容）。

## 已知限制

- 无 HTTPS（无域名）；如后续有域名，建议在服务器 nginx 上加一个 server 块反代 8080 并签 Let's Encrypt 证书，应用无需改动。
- 8080 需在云安全组放行；脚本不会改动服务器防火墙/安全组。

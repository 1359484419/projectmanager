# 跬步 Kuibu

轻量级自托管项目管理工具，为 5-20 人小团队而生。不积跬步，无以至千里。

## 功能

- **看板（Board）** —— 拖拽式 Sprint 看板，TODO → IN_PROGRESS → COMPLETED → DONE
- **Backlog** —— 待办池，快速创建任务，一键移入 Sprint
- **Sprint 管理** —— 创建、启动、关闭 Sprint，容量规划
- **Epic** —— 按季度/主题组织大颗粒目标
- **Dashboard** —— Sprint 总览、燃尽趋势、成员工作量
- **多租户** —— 邀请制团队，租户间数据隔离
- **MCP 集成** —— 内置 MCP server，Claude Code / Cursor 等 AI 工具可直接管理任务
- **AI Skill** —— 配套 [pm-skill](https://github.com/1359484419/pm-skill)，对话式整理任务、写日报/周报

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Java 21, Spring Boot 3.3, Spring Security (JWT + PAT), MyBatis |
| 前端 | React 19, Vite, React Router, TanStack Query, dnd-kit |
| 数据库 | PostgreSQL 16 |
| MCP | MCP Java SDK 2.0 (Streamable HTTP) |
| 部署 | 单机 fat jar + systemd（前端打入 Spring Boot static） |

## 快速开始

### 本地开发

```bash
# 1. 启动 PostgreSQL（Docker）
docker compose -f docker-compose.dev.yml up -d

# 2. 启动后端（默认 :8080）
cd backend
./mvnw spring-boot:run

# 3. 启动前端（默认 :5173，代理 API 到 8080）
cd frontend
npm install
npm run dev
```

### 生产部署

```bash
# 1. 构建（前端 build + fat jar）
./deploy/build.sh

# 2. 部署到服务器（幂等：初始化 DB/用户/systemd + 上传 + 重启 + 健康检查）
PM_HOST=ubuntu@<服务器IP> ./deploy/deploy.sh

# 3. 验证
curl http://<服务器IP>:8080/api/health   # → {"status":"ok"}
```

详见 [deploy/README.md](deploy/README.md)。

## MCP 集成

跬步内置 MCP server（端点 `/mcp`），支持 Streamable HTTP 协议。AI 编程工具（Claude Code、Cursor 等）可通过 PAT 令牌直接管理任务。

### 接入步骤

1. 登录 Web → 设置 → API 令牌 → 生成 PAT（`pmt_` 前缀）
2. 注册 MCP server：
   ```bash
   claude mcp add --transport http pm https://<域名>/mcp \
     --header "Authorization: Bearer pmt_<令牌>"
   ```
3. 安装配套 skill（可选）：
   ```bash
   claude skill add --url https://github.com/1359484419/pm-skill
   ```

可用工具：`list_projects`、`list_sprints`、`list_epics`、`list_my_tasks`、`create_tasks`、`update_task_status`

## 项目结构

```
projectmanager/
├── backend/          # Spring Boot 后端
├── frontend/         # React + Vite 前端
├── deploy/           # 部署脚本与配置
├── docs/             # 设计稿与 QA 记录
└── skill/            # MCP skill 定义与配置模板
```

## License

MIT

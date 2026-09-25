# 跬步 Kuibu

轻量级自托管项目管理工具，为 5-20 人小团队而生。不积跬步，无以至千里。

## 功能

- **看板（Board）** —— 拖拽式 Sprint 看板，TODO → IN_PROGRESS → COMPLETED → DONE
- **Backlog** —— 待办池，快速创建任务，一键移入 Sprint
- **Sprint 管理** —— 创建、启动、关闭 Sprint，容量规划
- **Epic** —— 按季度/主题组织大颗粒目标
- **Dashboard** —— Sprint 总览、燃尽趋势、成员工作量
- **多租户** —— 邀请制团队，租户间数据隔离
- **MCP 集成** —— 内置 MCP server（`/mcp`，PAT 鉴权），Claude Code / Cursor 等 AI 工具可直接查任务、建任务、推进状态、写日报
- **AI Skill** —— 配套 skill（仓库 `skill/`，镜像 [pm-skill](https://github.com/1359484419/pm-skill)），对话式整理任务、写日报/周报
- **自然语言助手** —— 页内「助手」面板（⌘/Ctrl+J），一句话查询、建任务、改状态；修改/删除必经确认卡，创建直接执行并可撤销（LangGraph ReAct 智能体，见 `agent/`）

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Java 21, Spring Boot 3.3, Spring Security (JWT + PAT), MyBatis |
| 前端 | React 19, Vite, React Router, TanStack Query, dnd-kit |
| 数据库 | PostgreSQL 16 |
| MCP | Python `mcp` 2.x `MCPServer`（无状态 Streamable HTTP + JSON 响应，挂在助手进程 `/mcp`）；Java `/mcp` 只做 PAT 鉴权 + 反代 |
| 助手 | Python 3.12 + FastAPI + LangGraph（手写 StateGraph，不用 langchain），OpenAI 兼容网关 |
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

# 4.（可选）启动自然语言助手 + MCP server（默认 :8090；后端需带 PM_ASSISTANT_URL=http://localhost:8090 启动）
cd agent
cp .env.example .env       # 填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL、PM_API_URL、AGENT_DB_URL
uv sync
uv run uvicorn app.main:app --port 8090
curl http://localhost:8090/health   # → {"status":"ok","llm":"ok","mcp":"ok"}
```

助手不启动时主应用不受影响：前端面板会提示「助手暂时不可用」，`/mcp` 返回 503 `MCP_UNAVAILABLE`。模型网关不可达只影响面板助手（`llm: unreachable`），MCP 照常可用。

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

跬步内置 MCP server（端点 `/mcp`，无状态 Streamable HTTP，JSON 响应，只接受 POST）。AI 编程工具（Claude Code、Cursor 等）用 PAT 令牌直接管理任务。架构：Java `/mcp` 只做 PAT 鉴权并注入租户/用户后反代到助手进程（`agent/app/mcp/`），工具用同一 PAT 回调 Java REST，因此租户隔离与权限矩阵与网页完全一致，活动来源记为 `MCP`。

### 接入步骤

1. 登录 Web → 右上角头像 → 个人设置 → 「个人访问令牌」→ 填名称、选绑定租户 → 生成 PAT（`pmt_` 前缀，明文只显示一次；一个 PAT 只绑一个租户）
2. 注册 MCP server（Claude Code；其它客户端参考 `skill/mcp-config.example.json`）：
   ```bash
   claude mcp add --transport http pm http://<host>:8080/mcp --header "Authorization: Bearer pmt_<令牌>"
   ```
3. 安装配套 skill（可选，Claude Code）：把 `skill/` 目录复制为 `~/.claude/skills/pm-assistant/`。没装 skill 的客户端可直接用 server 自带的提示词模板 `daily_report` / `weekly_report` / `plan_from_notes`。
4. 验证：对话里说「列出项目」，应调用 `list_projects` 返回项目列表。

### 工具清单

入参只用展示号（`XX-0`）、项目 key、名称与枚举，不接受也不返回内部 id；每个工具带 title / 中文描述 / annotations / outputSchema，失败返回 `isError` + `{code, message}`（无堆栈）。

| 级别 | 工具 |
|---|---|
| 读（readOnlyHint） | `list_projects`、`get_project_overview`、`list_my_work`（跨项目、`done_since` / `updated_since`，日报周报用）、`get_task`、`search_tasks`、`get_board`、`list_members` |
| 写 L1 创建 | `create_tasks`（批量 ≤20，`dry_run` 预览，`assignee` / `unassigned`，逐条 `created[]` + `failed[]`）、`add_comment`、`create_subtask` |
| 写 L2 修改（idempotentHint） | `update_task_status`、`update_task`、`move_task_to_sprint` |
| 写 L3 不可逆（destructiveHint） | `close_sprint`、`start_sprint` —— `confirm: true` 必填，调用前必须先向用户展示影响并获得确认 |

旧版（Java 内置 MCP）的 6 个工具名仍可用：`list_sprints` / `list_epics` / `list_my_tasks` 保留为独立工具；`list_projects` / `create_tasks` / `update_task_status` 同名且旧形参 `projectKey` / `target` / `taskSeq` 仍被接受。资源：`pm://projects`、`pm://me/work`、`pm://projects/{key}/sprints/current`。删除类、成员管理、记录（RECORD）不对外开放，请用网页或页内助手。用法与安全规则详见 [skill/SKILL.md](skill/SKILL.md)。

## 项目结构

```
projectmanager/
├── backend/          # Spring Boot 后端
├── frontend/         # React + Vite 前端
├── agent/            # 自然语言助手（Python，FastAPI + LangGraph）
├── deploy/           # 部署脚本与配置
├── docs/             # 设计稿与 QA 记录
└── skill/            # MCP skill 定义与配置模板
```

## License

MIT

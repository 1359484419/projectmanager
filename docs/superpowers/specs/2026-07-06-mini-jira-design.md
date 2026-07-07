# 小型自托管 Jira（projectmanager）设计文档

日期：2026-07-06
状态：已确认

## 1. 背景与目标

为 ~10 人小团队自建一个自托管的 Jira 替代品（Atlassian 已于 2026-03 停售 Data Center 新许可）。核心是 Sprint 管理与按天计的 point 容量规划。系统需支持**多租户**：多个独立团队/公司隔离使用，数据互不可见。

## 2. 技术栈与部署

| 层 | 选型 |
|---|---|
| 后端 | Java 21 + Spring Boot 3（Web / Security / Data JPA）+ Flyway |
| 数据库 | PostgreSQL 16 |
| 前端 | React + Vite + TypeScript + TanStack Query + dnd-kit + Recharts |
| 部署 | Docker Compose：app + postgres + Caddy（自动 HTTPS），公网单域名 |
| 认证 | 邮箱 + 密码，JWT（access + refresh）；邀请链接制加入租户 |

租户通过 URL 路径区分：`/t/{tenantSlug}/...`（前端路由与 API 一致：`/api/t/{tenantSlug}/...`）。

## 3. 多租户架构

**方案：共享库 + tenant_id 列**（已确认，放弃 schema-per-tenant 与 db-per-tenant——对该规模是过度设计）。

- 每张业务表带 `tenant_id`（NOT NULL，外键指向 `tenants`）。
- **TenantContext 拦截器层（harness）**：
  1. 从 URL 解析 `tenantSlug` → 查租户；
  2. 校验当前 JWT 用户对该租户的 membership，无则 404；
  3. 将 `tenantId` 写入请求级 TenantContext；
  4. Repository 层通过 Hibernate `@Filter`（或统一基类）自动追加 `WHERE tenant_id = :tid`。
- 业务代码**不手写**租户过滤，杜绝漏写导致的跨租户越权。
- 跨租户返回一律 404（不是 403），避免泄露资源存在性。

## 4. 数据模型

```
tenants      id, slug(唯一), name, created_at
users        id, email(全局唯一), password_hash, display_name, created_at
memberships  id, user_id → users, tenant_id → tenants, role(ADMIN|MEMBER)
             UNIQUE(user_id, tenant_id)
api_tokens   id, tenant_id, user_id, token_hash, name,
             created_at, last_used_at        # MCP 用个人访问令牌(PAT)
invites      id, tenant_id, token(唯一), role, expires_at, created_by
projects     id, tenant_id, key(租户内唯一, 如 "PM"), name,
             default_sprint_length(默认 WEEK_2), auto_rotate(默认 true)
epics        id, tenant_id, project_id, name, description,
             quarter(如 "2026-Q3", 可空), color,
             status(OPEN|DONE)
sprints      id, tenant_id, project_id, name,
             length(WEEK_1|WEEK_2|MONTH_1), start_date, end_date,
             status(PLANNED|ACTIVE|CLOSED)
capacity_overrides  id, tenant_id, sprint_id, user_id, capacity(整数)
             UNIQUE(sprint_id, user_id)
tasks        id, tenant_id, project_id, sprint_id(NULL=Backlog),
             epic_id(可空, → epics), type(STORY|BUG|TASK),
             seq(项目内自增, 展示为 PM-42), title, description,
             points(整数, 单位=天, 可空), assignee_id(可空),
             status(TODO|IN_PROGRESS|COMPLETED|DONE), rank(字典序排序键),
             created_at, done_at(进入 DONE 时记录)
comments     id, tenant_id, task_id, author_id, body, created_at
activities   id, tenant_id, task_id, actor_id,
             type(STATUS_CHANGED|POINTS_CHANGED|SPRINT_CHANGED|ASSIGNED|CREATED|...),
             old_value, new_value, at
```

## 5. 核心业务规则

### 5.1 Point 与容量

- 1 point = 1 人天。points 为正整数。
- 成员在某 Sprint 的默认容量 = Sprint 起止日期内的工作日数（周一至周五）：1 周 = 5，2 周 = 10，1 月 ≈ 22（按实际日期算）。
- `capacity_overrides` 可对个人下调（请假等）。
- 成员负载 = 该 Sprint 内指派给他的任务 points 之和；规划页显示 `已分配/容量`，超载红色、余量绿色。容量是**提示性**的，不硬性阻止超配。

### 5.2 Sprint 生命周期与自动轮转

- `PLANNED → ACTIVE → CLOSED`，单向流转。
- 创建时选 length（1 周/2 周/1 月，项目默认 **2 周**）与 start_date，end_date 自动算出（可微调）。
- 同一项目同时最多一个 ACTIVE Sprint。
- **自动轮转（harness：每日调度 job）**：项目开启 `auto_rotate`（默认开）时，ACTIVE Sprint 过了 end_date 由调度任务自动关闭，并按项目默认周期紧接着开启新 Sprint（顺序命名如 Sprint 24）；**未完成任务自动转入新 Sprint**，逐条写入 `activities` 可追溯。调度 job 必须幂等（重复执行不重复建 Sprint），服务停机数日后补跑只轮转一次到当前周期。
- 手动关闭仍可用：未完成任务由用户选择退回 Backlog 或移入指定 Sprint。
- 任务的 sprint 归属变化、状态变化均写入 `activities`。

### 5.3 季度（Quarter）与 Epic

- Quarter 不建表，是 Epic 上的一个字段（如 `2026-Q3`），按租户时区的自然季度。
- Epic 属于项目，可指定所属季度（也可暂不指定）；User Story / Bug / Task 可挂到某个 Epic 下（`epic_id` 可空）。
- **路线图（Roadmap）页**：按季度分组展示 Epic，每个 Epic 显示完成进度（已 DONE task 的 points / 总 points）。
- 任务类型 `type`：STORY（用户故事）/ BUG / TASK（杂项），看板与列表上用图标/颜色区分，可按类型筛选。
- Epic 完成（status=DONE）由用户手动标记，不自动判定。

### 5.3.1 任务四态工作流

`TODO → IN_PROGRESS → COMPLETED → DONE`（允许回退）。

- **COMPLETED** = 开发/自测完成待验收；**DONE** = 验收通过，真正完成。
- 燃尽图、Epic 进度、Sprint 结转均以 **DONE** 为准：非 DONE（含 COMPLETED）任务在自动轮转时转入新 Sprint。
- `done_at` 在任务进入 DONE 时写入，回退则清空。

### 5.4 燃尽图

- 不做每日快照定时任务。
- 由 `activities` 回放计算：Sprint 每一天的剩余 point = 已排入任务的 points 总和 − 截至当天已 DONE 的 points，随任务中途加入/移出动态修正。
- 同时提供理想斜线（容量线性递减）作对照。

## 6. API 形态

REST，JSON。示例：

```
POST /api/auth/login | refresh | register        # register 同时创建新租户并授予 ADMIN
POST /api/auth/accept-invite                      # 经邀请 token 注册/加入已有租户
GET  /api/me/tenants                         # 我所属的租户列表
POST /api/t/{slug}/projects
GET  /api/t/{slug}/projects/{key}/backlog
POST /api/t/{slug}/projects/{key}/sprints
POST /api/t/{slug}/projects/{key}/epics
GET  /api/t/{slug}/projects/{key}/roadmap    # 按季度分组的 Epic 及进度
POST /api/t/{slug}/sprints/{id}/start | close
GET  /api/t/{slug}/projects/{key}/dashboard  # 当前 Sprint 四状态概览
GET  /api/t/{slug}/projects/{key}/sprints?withTasks=true  # All Sprints 列表
GET  /api/t/{slug}/sprints/{id}/board        # 看板数据（四列）
GET  /api/t/{slug}/sprints/{id}/capacity     # 每人容量与负载
GET  /api/t/{slug}/sprints/{id}/burndown
PATCH /api/t/{slug}/tasks/{id}               # 状态/指派/points/sprint/rank
POST /api/t/{slug}/tasks/{id}/comments
GET  /api/t/{slug}/tasks/{id}/activities
POST /api/t/{slug}/invites                   # ADMIN 生成邀请链接
```

统一错误体 `{code, message}`；跨租户资源一律 404。

## 6.5 MCP 接口层与 Agent Skill

让团队成员在自己的 agent（Claude Code / Cursor / 其他 MCP 客户端）里用自然语言直接操作系统，免去手写日报/周报/计划。典型场景：**「把我今天做的这些事整理成 user story，挂到当前（或下个）Sprint」**。

### 架构

- **MCP Server 内置在 Spring Boot 应用里**（MCP Java SDK，Streamable HTTP，端点 `/mcp`），不单独部署进程——同一套服务、同一套租户 harness。
- **认证**：个人访问令牌（PAT），用户在「个人设置」页生成，`Authorization: Bearer <token>` 携带；PAT 绑定 用户+租户，MCP 请求走与 REST 相同的 TenantContext 拦截器，隔离逻辑零重复。
- **审计**：MCP 的写操作与 REST 一样写入 `activities`，并标记来源为 MCP。

### 首版 MCP 工具（写为主，读为辅）

| 工具 | 用途 |
|---|---|
| `list_projects` / `list_sprints` / `list_epics` | 查询挂载目标（当前/下个 Sprint、Epic 列表） |
| `create_tasks` | **批量**创建任务：type/title/描述/points/epic/指派（默认自己），target 可指定 `current_sprint` / `next_sprint` / `backlog` |
| `update_task_status` | 推进任务状态（如整理完直接标 COMPLETED） |
| `list_my_tasks` | 我在某 Sprint 的任务与状态（供 agent 生成日报/周报文字） |

爆炸半径控制：`create_tasks` 工具描述中要求 agent 先向用户展示将创建的清单再调用；单次批量上限 20 条。若指定 `next_sprint` 而下个 PLANNED Sprint 不存在，自动按项目默认周期预建一个。

### Agent Skill

- 仓库内维护 `skill/` 目录，发布一个可分发的 skill 包（`SKILL.md` + MCP 连接配置示例），团队成员装到自己的 agent 里。
- Skill 内容：如何生成/配置 PAT、常用话术到工具的映射（整理今日工作→`create_tasks`、写周报→`list_my_tasks` 后按模板生成文字）、日报/周报输出模板。
- 报告文字由用户自己的 agent 生成，系统**不存档报告**（首版）。

## 7. 前端页面（首版 12 个）

1. 登录 / 注册 / 接受邀请（开放注册：注册时即创建一个新租户，注册者成为该租户 ADMIN；已有租户的成员经邀请链接加入）
2. 租户/项目选择
3. **Dashboard（项目首页）**：当前 ACTIVE Sprint 概览——Story/Bug 按 TODO / IN_PROGRESS / COMPLETED / DONE 四种状态分组展示，含各状态计数、Sprint 剩余天数、整体完成度
4. Backlog：任务列表、快速创建、拖拽进 Sprint
5. Sprint 看板：TODO / IN_PROGRESS / COMPLETED / DONE 四列拖拽
6. **All Sprints**：所有 Sprint 倒序列表（含 ACTIVE/CLOSED/PLANNED），每个 Sprint 分组下列出其全部任务，**默认全部展开**，可折叠
7. Sprint 规划：成员容量条（已分配/容量，超载标红）
8. 报表：燃尽图、每人负载
9. 任务详情抽屉：编辑（含类型、所属 Epic）、评论、变更历史
10. **路线图**：按季度分组的 Epic 卡片 + 完成进度，Epic 展开可见其下 Story/Bug
11. 租户管理（仅 ADMIN）：成员列表、邀请链接、Sprint 周期默认值与自动轮转开关
12. 个人设置：改名、改密码、**PAT 管理（生成/吊销 MCP 访问令牌）**

## 8. 首版明确不做（YAGNI）

子任务、自定义工作流、自定义字段、附件上传、邮件通知、全文搜索、细粒度权限（仅 ADMIN/MEMBER）、节假日日历（用 capacity override 顶替）、SSO。

## 9. 测试策略

- **后端**：JUnit 5 + Testcontainers（真实 PG）。重点：
  - 租户隔离：A 租户 token 访问 B 租户任一资源 → 404；
  - 容量计算（各 length 的工作日数、override）；
  - Sprint 关闭时任务流转；
  - **自动轮转 job 的幂等性**（重复触发、停机补跑只轮转一次）；
  - 燃尽图回放正确性；
  - MCP：PAT 认证、失效令牌拒绝、跨租户隔离同样 404、`create_tasks` 批量上限。
- **前端**：Playwright 冒烟一条主流程：登录 → 建任务 → 拖进 Sprint → 看板拖拽到 DONE → 燃尽图出数。
- 交付前在真实 Docker Compose 环境端到端验证。

## 10. 工作量预估（vibe coding 口径）

| 阶段 | 预估 |
|---|---|
| 骨架 + 认证 + 多租户 harness | 0.5 天 |
| Backlog + 看板 + Sprint 生命周期 + 自动轮转 | 1 天 |
| Epic/季度路线图 + 任务类型 | 0.5 天 |
| Dashboard + All Sprints 页 | 0.5 天 |
| MCP Server + PAT + Skill 包 | 0.5 天 |
| 容量条 + 燃尽图 + 评论/历史 | 1 天 |
| Docker 部署 + 联调 + 安全测试 | 0.5 天 |
| **合计** | **约 4.5 个工作日** |

不可压缩项：真机部署联调、多租户越权测试。

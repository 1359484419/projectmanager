---
name: pm-assistant
description: 通过跬步（Kuibu / projectmanager）的 MCP 工具管理任务与迭代。当用户要写日报、写周报、站会摘要、把今日/本周工作整理成任务、把任务挂到当前或下个迭代、更新任务状态、查自己的任务、关闭/开始迭代时使用此 skill。触发词：日报、周报、整理任务、建任务、挂 sprint、standup、daily report、weekly report、create tasks、sprint。
---

# pm-assistant：跬步任务助手

通过跬步内置的 MCP server（Claude Code 里的服务名 `pm`）操作自托管的跬步：整理工作成任务、挂迭代、推进状态、生成日报/周报。

术语：迭代 = Sprint，长期计划 = Epic，待办 = Backlog，天数 = points。任务用**展示号**指代（如 `XX-0`），项目用 **key**；负责人、迭代、长期计划一律用**名称**——工具不接受也不返回内部 id。

## 前置：连接配置（一次性）

1. **生成 PAT（个人访问令牌）**：登录跬步 Web → 右上角头像 → 「个人设置」 → 「个人访问令牌」卡片 → 填令牌名称、选绑定租户 → 「生成令牌」。明文令牌（`pmt_` 开头）**只显示一次**，立即复制保存。一个 PAT 只绑定一个租户；换租户要另生成。
2. **注册 MCP server**（Claude Code；其它客户端参考同目录 `mcp-config.example.json`）：

   ```bash
   claude mcp add --transport http pm http://<host>:8080/mcp --header "Authorization: Bearer pmt_<你的令牌>"
   ```

   `<host>` 是跬步服务器地址（无域名时直接用 IP，端点是 Java 的 8080，不是助手端口）；加 `--scope user` 可对所有项目生效。
3. **安装本 skill**（可选）：把仓库的 `skill/` 目录复制为 `~/.claude/skills/pm-assistant/`（Claude Code 启动时自动发现）。没装 skill 的客户端（Cursor 等）可以直接用 server 自带的提示词模板 `daily_report` / `weekly_report` / `plan_from_notes`，内容与本文件的流程一致。
4. **验证**：对话里问「列出项目」，`list_projects` 应返回项目列表；`claude mcp list` 里 `pm` 应显示已连接。凭证错误会得到 401 `UNAUTHENTICATED`（PAT 被吊销、或被移出租户后同样如此）；503 `MCP_UNAVAILABLE` 表示服务器上的 `pm-agent` 服务没起。

## 可用工具

共 14 个新工具 + 6 个旧名兼容（详见表后说明）。所有入参都是 snake_case、不接受未知字段（多给字段直接校验失败并提示）。

| 工具 | 级别 | 用途与参数 |
|---|---|---|
| `list_projects()` | 读 | 项目列表（key、名称）。其它工具的 `project_key` 从这里取；租户只有一个项目时其它工具可省略 `project_key` |
| `get_project_overview(project_key?)` | 读 | 一次拿到当前/下一/最近关闭的迭代、当前迭代四态计数与完成百分比、长期计划列表（替代旧的 list_sprints + list_epics + 仪表盘三次调用） |
| `list_my_work(scope?, project_key?, done_since?, updated_since?)` | 读 | 指派给我的任务，**缺省跨全部项目**。`scope`：`current`（缺省）/ `next` / `previous`（最近关闭的一个迭代）/ `backlog` / `all`（当前 + 下一 + **全部已关闭迭代** + 待办）；`done_since` / `updated_since` 为 `yyyy-MM-dd`（Asia/Shanghai）。每行含 displayKey / projectKey / title / type / status / points / sprintName / epicName / doneAt / updatedAt / description 摘要（≤200 字）/ subtaskDone / subtaskTotal。**日报、周报、standup 用这个** |
| `get_task(task_key)` | 读 | 任务详情 + 子任务 + 评论（写「进展」时取细节） |
| `search_tasks(q)` | 读 | 按关键词搜标题/描述，全租户，最多 20 条 |
| `get_board(project_key?, sprint?)` | 读 | 某个迭代（`current` / `next` / 名称）所有人的任务按 TODO / IN_PROGRESS / COMPLETED / DONE 四列展示 |
| `list_members()` | 读 | 租户成员（姓名、邮箱、角色）；指派负责人前先查 |
| `create_tasks(project_key?, sprint?, tasks[], dry_run?)` | 写 L1 | 批量建任务 ≤20 条。`sprint`：`current` / `next` / `backlog`（缺省）/ 迭代名称；每条 `{type: STORY|BUG|TASK, title, description?, points?, epic_name?, assignee?, unassigned?}`，`assignee` 为姓名/邮箱/`me`，缺省指派给自己，`unassigned: true` 明确留空。**先 `dry_run: true` 拿预览**（负责人/长期计划/迭代已解析成名称），确认后再正式创建；返回 `created[]` + `failed[]` 逐条结果 |
| `add_comment(task_key, body)` | 写 L1 | 给任务加评论 |
| `create_subtask(task_key, title)` | 写 L1 | 给任务加子任务 |
| `update_task_status(task_key, status)` | 写 L2 | 推进状态：TODO / IN_PROGRESS / COMPLETED / DONE（允许回退） |
| `update_task(task_key, title?, description?, points?, assignee?, clear_assignee?, epic_name?, clear_epic?)` | 写 L2 | 改标题/描述/天数/负责人/长期计划；`clear_*: true` 表示清空 |
| `move_task_to_sprint(task_key, sprint)` | 写 L2 | 移入迭代（`current` / `next` / 名称）或移回待办（`backlog`） |
| `close_sprint(project_key?, sprint?, unfinished, target_sprint?, confirm)` | 写 L3 | 关闭迭代（不可逆）。`unfinished`：`backlog`（未完成移回待办）或 `move`（移到 `target_sprint`，`next` 或名称）。**`confirm: true` 必填** |
| `start_sprint(project_key?, sprint, confirm)` | 写 L3 | 把已计划的迭代设为进行中（同一项目同时只能有一个）。**`confirm: true` 必填** |
| `list_sprints(projectKey?)` | 读（旧名） | 项目的迭代与状态、起止日期。新代码请改用 `get_project_overview` |
| `list_epics(projectKey?)` | 读（旧名） | 项目的长期计划。新代码请改用 `get_project_overview` |
| `list_my_tasks(projectKey?, sprint?)` | 读（旧名） | 我在 `current` / `previous` 迭代的任务，只是 `list_my_work` 的子集。新代码请改用 `list_my_work` |

**旧名兼容**：接入过旧版（Java 内置 MCP）的客户端不用改配置，6 个旧工具名仍可用——`list_sprints` / `list_epics` / `list_my_tasks` 保留为独立工具（见表末三行）；`list_projects` / `create_tasks` / `update_task_status` 与新工具同名，旧形参 `projectKey`、`target`（`current_sprint` / `next_sprint` / `backlog`）、`taskSeq` 仍被接受（schema 里只展示新名）。

**资源与提示词**：`pm://projects`（项目列表）、`pm://me/work`（我的全部任务，跨项目）、`pm://projects/{key}/sprints/current`（当前迭代看板）；提示词 `daily_report(project_key?)`、`weekly_report(project_key?)`、`plan_from_notes(notes)`。

## 安全规则（必须遵守）

- **L3 工具（`close_sprint` / `start_sprint`）不可逆：必须先向用户展示影响并获得明确确认，之后才传 `confirm: true`。** 展示内容至少包括：项目、迭代名称与起止日期、关闭时未完成任务的数量与去向（回待办 / 移到哪个迭代）。不带 `confirm` 或为 false 会得到 `CONFIRM_REQUIRED`，这是设计如此，不要为了让调用通过而自行填 true。
- **`create_tasks` 先 `dry_run: true` 展示预览再执行**：把预览里的标题 / 类型 / 天数 / 负责人 / 长期计划 / 目标迭代列成表格给用户看，`failed[]` 里的项先纠正（NOT_FOUND / AMBIGUOUS），用户确认后再去掉 `dry_run` 正式创建，并把返回的展示号回显。未确认不得创建。
- 单次 `create_tasks` 不超过 20 条；更多请分批并逐批确认。
- L2 修改（状态 / 字段 / 移动迭代）幂等可回退，用户指令明确时直接执行并回显结果；含糊时（"完成"是 COMPLETED 还是 DONE？"上个迭代"是哪个？）先问一句。
- 不确定项目 key、迭代名、负责人时先用 `list_projects` / `get_project_overview` / `list_members` 查并向用户确认，不要猜；`AMBIGUOUS` 返回的 `candidates` 让用户选，不要自动挑第一个。
- 天数（points）是 **0.5-5、步进 0.5** 的人天；用户没说就留空，不要编造。
- 不要向用户念内部 id（工具也不会返回），只用展示号、名称。

## 能力边界（做不到的事与替代）

- 不能创建迭代：`sprint: "next"` 在没有已计划迭代时返回 `NOT_FOUND`（不会自动预建），请用户在网页「所有迭代」页先建。
- 不能创建「记录」（RECORD 类型）、不能删除任务 / 子任务 / 迭代 / 长期计划、不能管理成员或容量——这些留给网页或页内助手。
- `search_tasks` 最多 20 条且只按关键词；`list_my_work(scope="previous")` 只取最近关闭的一个迭代，`scope="all"` 才遍历当前 / 下一 / 全部已关闭迭代 + 待办（迭代越多请求越多），周报跨两个以上迭代时用 `scope="all"` + `done_since` 补。
- 工具只看得到 PAT 绑定的那个租户；换租户要换 PAT。

## 标准流程

### 1. 整理今日工作 → 建任务挂迭代

用户说「把我今天做的这些事整理成任务挂到当前迭代」：

1. 把口述内容整理成任务草稿：每条 `type`（STORY / BUG / TASK，没说就 TASK）、`title`（动宾短语一句话）、可选 `description` / `points`。
2. 需要挂长期计划或指派他人时，先 `get_project_overview` / `list_members` 核对名称。
3. `create_tasks(dry_run: true, sprint: "current", tasks: [...])` 拿预览，**表格展示并请求确认**（含目标迭代名）。
4. 确认后去掉 `dry_run` 正式创建；把 `created[]` 的展示号（如 `XX-0`）回显，`failed[]` 逐条说明原因。
5. 用户说「这些已经做完了」时，逐条 `update_task_status(task_key, "COMPLETED")`（验收过/上线了用 `DONE`）。

### 2. 日报

用户说「写今天的日报」：

1. `list_my_work(scope: "current")` 取当前迭代我的全部任务（进行中 / 待办从这里来；多项目成员不传 `project_key`，自动跨项目）；再 `list_my_work(scope: "all", updated_since: "<今天 yyyy-MM-dd>")` 拉出今天变更过的任务——它包含 `done_since` 能筛到的（今天进入 `DONE`），也包含只改了状态、没有 `doneAt` 的 `COMPLETED`（后端只在进入 `DONE` 时写 `doneAt`）。
2. 归组，**今日完成**的唯一规则：doneAt 是今天，或状态为 COMPLETED 且 updatedAt 是今天 → 今日完成（迭代里早先就已 `COMPLETED`/`DONE` 的不算今天）；`IN_PROGRESS` → **进行中**（进展用 `description` 摘要与 `subtaskDone/subtaskTotal`，需要更多细节再 `get_task` 看评论与子任务）；`TODO` → **待办 / 明日计划**。
3. 只输出文字，不创建或修改任何任务；系统不存档报告。

```markdown
## 日报 · {YYYY-MM-DD} · {姓名}

**今日完成**
- {XX-0} {标题}（{天数}天）

**进行中**
- {XX-0} {标题} — {一句话进展}

**待办 / 明日计划**
- {XX-0} {标题}

**风险 / 阻塞**
- {无则写"无"}
```

### 3. 周报

用户说「写周报」：

1. `list_my_work(scope: "current")` + `list_my_work(scope: "previous")` 汇总本周期与上周期；用 `doneAt` 判断哪些是本周完成的（跨迭代边界时改用 `scope: "all", done_since: "<本周一>"`）。
2. 「本周完成」以 `DONE`（或本周 `doneAt`）为准，天数小计 = 这些任务 `points` 之和；进行中的写进展与预计完成时间（细节 `get_task`）。
3. 只输出文字，不创建或修改任何任务。

```markdown
## 周报 · {YYYY-Www} · {姓名}

**本周完成**（合计 {N} 天）
- {XX-0} {标题}（{天数}天）

**进行中 / 结转下周**
- {XX-0} {标题} — {进展与预计完成时间}

**下周计划**
- {计划项}

**问题与需要的支持**
- {无则写"无"}
```

### 4. 关闭 / 开始迭代（L3）

用户说「把这个迭代关了」：

1. `get_project_overview` 取当前迭代名与日期，`get_board(sprint: "current")` 数一下未完成任务。
2. 向用户展示：迭代名、起止日期、未完成任务数、去向（回待办 / 移到下一迭代）、"此操作不可逆"，**等用户明确同意**。
3. 同意后 `close_sprint(sprint: "current", unfinished: "backlog" | "move", target_sprint?: "next", confirm: true)`；开始迭代同理 `start_sprint(sprint: "<名称>" | "next", confirm: true)`。

## 错误处理

工具失败返回 `isError` + `{code, message}`（AMBIGUOUS 另带 `candidates`），没有堆栈：

| code | 含义 | 下一步 |
|---|---|---|
| `NOT_FOUND` | 项目 key / 展示号 / 迭代名 / 成员不存在 | 按 message 提示核对（`list_projects`、`search_tasks`、`list_members`），不要换个写法盲试 |
| `AMBIGUOUS` | 名称匹配到多个，或租户有多个项目却没给 `project_key` | 把 `candidates` 给用户选后重调 |
| `VALIDATION` | 入参不合法（未知字段、天数步进、超过 20 条、状态枚举） | 按 message 改参数重调 |
| `CONFIRM_REQUIRED` | L3 工具没带 `confirm: true` | 回到「安全规则」第一条：先展示影响并取得同意 |
| `CONFLICT` / `ACTIVE_SPRINT_EXISTS` 等 | 后端业务规则（乐观锁、已有进行中迭代…） | 如实告诉用户，不要自动重试写操作 |
| `UNAUTHENTICATED`（HTTP 401） | PAT 失效、被吊销、或已被移出租户 | 请用户重新生成 PAT 并 `claude mcp add` |
| `MCP_UNAVAILABLE`（HTTP 503） | 服务器上的 `pm-agent` 没起 | 请管理员 `systemctl status pm-agent` |

## 常用话术 → 工具映射

| 用户说 | 动作 |
|---|---|
| "把这些事整理成任务挂到当前迭代" | 整理 → `create_tasks(dry_run)` 展示确认 → `create_tasks(sprint: "current")` |
| "放到下个迭代" | 同上，`sprint: "next"`（没有已计划迭代会 NOT_FOUND，请先在网页创建） |
| "先放待办" | 同上，`sprint: "backlog"` |
| "XX-0 做完了" | `update_task_status("XX-0", "COMPLETED")`；"验收过了 / 上线了" 用 `DONE`；"开始做了" 用 `IN_PROGRESS` |
| "XX-0 改成 2 天 / 指给张三 / 挂到登录改造" | `update_task("XX-0", points: 2)` / `assignee: "张三"` / `epic_name: "登录改造"` |
| "XX-0 挪到下个迭代 / 挪回待办" | `move_task_to_sprint("XX-0", "next" / "backlog")` |
| "给 XX-0 记一句：接口已联调" | `add_comment("XX-0", "接口已联调")` |
| "我这个迭代都有啥任务" / "我有哪些待办" | `list_my_work(scope: "current" / "backlog")` 列表格 |
| "项目现在什么情况" | `get_project_overview` |
| "写日报 / 写周报 / standup" | 流程 2 / 流程 3 |
| "关掉当前迭代 / 开始下个迭代" | 流程 4（展示影响 → 同意 → `confirm: true`） |

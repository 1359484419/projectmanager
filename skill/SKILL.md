---
name: pm-assistant
description: 通过 projectmanager 的 MCP 工具管理任务与 Sprint。当用户要写日报、写周报、整理今日/本周工作成任务（user story）、把任务挂到当前或下个 Sprint、更新任务状态、查自己的 Sprint 任务时使用此 skill。触发词：日报、周报、整理任务、建任务、挂 sprint、standup。
---

# pm-assistant：projectmanager 任务助手

通过内置 MCP server（工具前缀 `pm`）操作自托管 projectmanager：整理工作成任务、挂 Sprint、生成日报/周报。

## 前置：连接配置（一次性）

1. **生成 PAT（个人访问令牌）**：
   - 登录 projectmanager Web → 右上角「个人设置（Settings）」→「API 令牌」→ 输入名称与所属租户 → 生成。
   - 明文令牌（`pmt_` 开头）**只显示一次**，立即复制保存。
2. **注册 MCP server**（Claude Code 示例，其他客户端参考 `mcp-config.example.json`）：

   ```bash
   claude mcp add --transport http pm https://<你的域名>/mcp \
     --header "Authorization: Bearer pmt_<你的令牌>"
   ```

3. 验证：对话里问「列出项目」，`list_projects` 应返回项目列表。

## 可用工具

| 工具 | 用途 |
|---|---|
| `list_projects` | 项目列表（key、名称） |
| `list_sprints(projectKey)` | active / next / recent（最近关闭）Sprint |
| `list_epics(projectKey)` | Epic 列表（创建任务时可挂 epicId） |
| `list_my_tasks(projectKey, sprint)` | 我在 current / previous Sprint 的任务 |
| `create_tasks(projectKey, target, tasks)` | 批量建任务（≤20 条），target: current_sprint / next_sprint / backlog |
| `update_task_status(taskSeq, status)` | 推进状态：TODO / IN_PROGRESS / COMPLETED / DONE |

## 安全规则（必须遵守）

- **创建任务前必须先向用户展示完整清单**（标题 / 类型 / points / 挂载目标 / epic），**等用户明确确认后**才调用 `create_tasks`。未确认不得调用。
- 单次 `create_tasks` 不超过 20 条；更多请分批并逐批确认。
- 不确定项目 key 或挂载目标时，先用 `list_projects` / `list_sprints` 查询并向用户确认，不要猜。
- points 单位是人天（正整数）；用户没说就留空，不要编造。

## 标准流程

### 1. 整理今日工作 → 建任务挂 Sprint

用户说「把我今天做的这些事整理成任务挂到当前 Sprint」：

1. 把用户口述内容整理成任务草稿：每条含 `type`（STORY/BUG/TASK）、`title`（动宾短语，一句话）、可选 `description`/`points`。
2. 需要挂 Epic 时先 `list_epics` 让用户选。
3. **向用户展示清单表格并请求确认**（含 target：current_sprint / next_sprint / backlog）。
4. 确认后调 `create_tasks`；把返回的任务号（如 `PM-42`）回显给用户。
5. 用户说「这些已经做完了」时，逐条 `update_task_status(seq, "COMPLETED")`（或 DONE，按用户意思）。

### 2. 日报

用户说「写今天的日报」：

1. `list_my_tasks(projectKey, "current")` 取当前 Sprint 我的任务。
2. 按状态归组填入下方日报模板；DONE/COMPLETED 归「今日完成」，IN_PROGRESS 归「进行中」，TODO 归「待办」。
3. 只输出文字，系统不存档报告。

```markdown
## 日报 · {YYYY-MM-DD} · {姓名}

**今日完成**
- {PM-42} {标题}（{points}pt）

**进行中**
- {PM-43} {标题} — {一句话进展}

**待办 / 明日计划**
- {PM-44} {标题}

**风险 / 阻塞**
- {无则写"无"}
```

### 3. 周报

用户说「写周报」：

1. `list_my_tasks(projectKey, "current")` + `list_my_tasks(projectKey, "previous")` 汇总本周期与上周期。
2. 按下方模板生成；「本周完成」以 DONE 为准，点数小计 = DONE 任务 points 之和。

```markdown
## 周报 · {YYYY-Www} · {姓名}

**本周完成**（合计 {N}pt）
- {PM-42} {标题}（{points}pt）

**进行中 / 结转下周**
- {PM-43} {标题} — {进展与预计完成时间}

**下周计划**
- {计划项}

**问题与需要的支持**
- {无则写"无"}
```

## 常用话术 → 工具映射

| 用户说 | 动作 |
|---|---|
| "把这些事整理成 story 挂到当前 sprint" | 整理 → 展示清单确认 → `create_tasks(target=current_sprint)` |
| "放到下个 sprint" | 同上，`target=next_sprint`（无下个 Sprint 会自动预建） |
| "先放 backlog" | 同上，`target=backlog` |
| "PM-42 做完了" | `update_task_status("PM-42", "COMPLETED")`；用户说"验收过了/上线了"用 `DONE` |
| "我这个 sprint 都有啥任务" | `list_my_tasks(projectKey, "current")` 列表格 |
| "写日报 / 写周报" | 流程 2 / 流程 3 |

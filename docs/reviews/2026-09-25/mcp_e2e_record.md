# MCP 端到端集成验证记录

日期：2026-09-25（业务日 `BizTime.today()` = 2026-09-26，Asia/Shanghai 已过零点）
链路：mcp 2.x 客户端（`streamable_http_client` + `create_mcp_http_client(headers=Authorization: Bearer pmt_…)`）→ Java 反代 `http://localhost:8081/mcp`（`McpProxyController`，PAT 校验 + 注入 `X-PM-*`）→ Python `agent/app/mcp`（`MCPServer`，无状态 Streamable HTTP + JSON 响应）→ Java REST。
临时租户：`mcp-e251ba07`（集成甲 ADMIN / 李雷 MEMBER；项目 KB；Sprint 1 ACTIVE、Sprint 2 PLANNED；长期计划「支付重构」）。PAT 由 `POST /api/me/tokens {name, tenantSlug}` 生成（明文只在脚本内存里，未落盘）。
脚本：`scratchpad/mcp_e2e.py`（主流程）、`mcp_e2e_followup.py`（修复后补验）；原始 JSON：`mcp_e2e_calls.json` / `mcp_e2e_followup.json`。

## 结论

| 项 | 结果 |
|---|---|
| initialize | 通过：server `kuibu`（title 跬步项目管理）、protocolVersion 2025-11-25、capabilities tools/resources/prompts、中文 instructions |
| tools/list | **18 个**（15 精选 + 3 旧名别名 `list_sprints/list_epics/list_my_tasks`），全部带 title / annotations / outputSchema；入参 schema 合计约 9756 字符。任务文本写的「20 个」是审查报告「14 新 + 6 旧名」的算术，实际 6 个旧名中 3 个与新名同名（同一工具兼容旧形参），故目录里是 18 条，与 `tests/test_mcp.py::CORE_TOOLS ∪ ALIAS_TOOLS`、`skill/SKILL.md` 工具表一致 |
| resources / prompts | `pm://projects`、`pm://me/work`、模板 `pm://projects/{key}/sprints/current`；提示词 `daily_report / weekly_report / plan_from_notes`，均可读 |
| 流程 1 整理今日工作 | 通过：`create_tasks(dry_run)` 预览已把负责人 / 长期计划 / 目标迭代解析成名称；去掉 dry_run 真建 4 条挂 Sprint 1（后端核验 assignee/epic/sprint 一致）；旧形参 `projectKey/target` 等价；未知字段 `assigneeId` → `VALIDATION`（不再静默丢弃） |
| 推进状态 | 通过：旧名 `taskSeq` 与新名 `task_key` 各一次；add_comment / create_subtask / update_task(points+assignee) / move_task_to_sprint(next) 全部 200，输出只有展示号与名称 |
| 日报 | `list_my_work(scope=all, done_since=今天)` + `get_task`（含子任务、评论）可用；`list_my_tasks` 旧名与 `get_board / search_tasks / list_members / list_sprints / list_epics` 同样可用。注意 `doneAt` 只在进入 DONE 时写（Java `TaskService` 设计如此），COMPLETED 不算，故 done_since 只命中 DONE（补验：KB-1 置 DONE 后 done_since=今天 命中 1 条、done_since=2099 为 0）；COMPLETED 的「今日完成」要靠 `scope=current` 的 status 归组（`daily_report` 提示词已这样写） |
| close_sprint 无 confirm | 拒绝。**修复前**漏传 confirm 返回 `VALIDATION: confirm: Field required`，与 SKILL.md 承诺的 `CONFIRM_REQUIRED` 不一致（只有 confirm=false 才是 `CONFIRM_REQUIRED`）；**已修**：`agent/app/mcp/_exec.py::run_tool` 把「缺 confirm」的校验错误映射为 `CONFIRM_REQUIRED`（`tests/test_mcp.py` 两个 confirm 用例先改成断言 code 看到红，再实现），修复后重启 8090 经反代复验 close/start 均返回 `CONFIRM_REQUIRED`；其它缺参（如 `unfinished`）仍是 `VALIDATION` |
| close_sprint confirm=true | 成功：Sprint 1 → CLOSED，未完成（含 COMPLETED）移到 Sprint 2；随后 `start_sprint(Sprint 2, confirm)` 成功；再 start 已 ACTIVE 的迭代得到后端业务错 `SPRINT_NOT_PLANNED`（不重试、无堆栈；消息仍是英文，属已知 P2「后端英文错误直出」） |
| 错误响应 | 假 PAT / 无 Authorization / 浏览器 JWT → 401 `{code: UNAUTHENTICATED}`；GET / DELETE `/mcp` → 405 JSON-RPC 形状错误体；坏 Accept → 406、坏 JSON → 400（-32700）、未知 `Mcp-Session-Id` 被无状态服务忽略仍 200。**全部无堆栈**（正文中不含 Exception / Traceback / at pm.） |
| 工具级错误 | NOT_FOUND 带定位提示（「任务 KB-999 不存在，可用 search_tasks 查找」「项目 NOPE 不存在，可用 list_projects 查看」）、非法状态 / 日期格式 → VALIDATION 带枚举说明 |

## 逐条请求 / 响应摘要（主流程）


### setup

- **POST /api/me/tokens**（HTTP 200）
  - 请求：`{"name": "e2e", "tenantSlug": "mcp-e251ba07"}`
  - 响应：`{"id": 9, "name": "e2e", "tenantSlug": "mcp-e251ba07", "createdAt": "2026-09-25T16:03:38.840639Z"}`

### 协议

- **initialize**（HTTP 200 · 25ms）
  - 请求：`{}`
  - 响应：`{"serverInfo": {"name": "kuibu", "title": "跬步项目管理", "version": "", "description": null, "website_url": null, "icons": null}, "protocolVersion": "2025-11-25", "capabilities": {"experimental": {}, "prompts": {"list_changed": false}, "resources": {"subscribe": false, "list_changed": false}, "tools": {"list_changed": false}}, "instructions": "跬步（Kuibu）项目管理：任务 / 迭代（Sprint）/ 长期计划（Epic）/ 待办（Backlog）。任务用展示号指代（如 XX-0），项目用 key；负责人、迭代、长期计划一律用名称，工具不接受也不返回内部 id。先 list_projects 拿 project_key；写日报/周报用 list_my_work（缺省跨项目）。创建任务：先 create_tasks(dry_run=true) 拿预览，向用户展示清单并确认后再正式创建，单次不超过 20 条。close_sprint / start_sprint 不可逆：先向用户展示影响并取得明确同意，再带 confirm=true "}`
- **tools/list**（HTTP 200）
  - 请求：`{}`
  - 响应：`{"count": 18, "names": ["list_projects", "get_project_overview", "list_my_work", "get_task", "search_tasks", "get_board", "list_members", "create_tasks", "add_comment", "create_subtask", "update_task_status", "update_task", "move_task_to_sprint", "close_sprint", "start_sprint", "list_sprints", "list_epics", "list_my_tasks"], "annotations": {"list_projects": {"read_only_hint": true, "destructive_hint": false, "idempotent_hint": true, "open_world_hint": false}, "get_project_overview": {"read_only_hint": true, "destructive_hint": false, "idempotent_hint": true, "open_world_hint": false}, "list_my_work": {"read_only_hint": true, "destructive_hint": false, "idempotent_hint": true, "open_world_hin…`
- **resources/prompts**（HTTP 200）
  - 请求：`{}`
  - 响应：`{"resources": ["pm://projects", "pm://me/work"], "templates": ["pm://projects/{key}/sprints/current"], "prompts": ["daily_report", "weekly_report", "plan_from_notes"]}`

### 流程1

- **list_projects**（HTTP 200 · ok · 55ms）
  - 请求：`{"tool": "list_projects", "args": {}}`
  - 响应：`{"projects": [{"key": "KB", "name": "看板项目", "defaultSprintLength": "WEEK_2", "autoRotate": true}]}`
- **get_project_overview**（HTTP 200 · ok · 51ms）
  - 请求：`{"tool": "get_project_overview", "args": {"project_key": "KB"}}`
  - 响应：`{"projectKey": "KB", "projectName": "看板项目", "currentSprint": {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}, "nextSprint": {"name": "Sprint 2", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "PLANNED"}, "lastClosedSprint": null, "counts": {"TODO": 0, "IN_PROGRESS": 0, "COMPLETED": 0, "DONE": 0}, "donePct": 0.0, "epics": [{"name": "支付重构", "description": null, "quarter": "2026-Q4", "color": null, "status": "OPEN"}]}`
- **create_tasks dry_run**（HTTP 200 · ok · 58ms）
  - 请求：`{"tool": "create_tasks", "args": {"project_key": "KB", "sprint": "current", "dry_run": true, "tasks": [{"type": "TASK", "title": "修复助手面板 SSE 断流", "points": 1, "description": "线上反馈：长回复时断开"}, {"type": "STORY", "title": "助手支持语音输入", "points": 1.5, "epic_name": "支付重构"}, {"type": "BUG", "title": "看板拖拽偶发闪回", "assignee": "李雷"}, {"type": "TASK", "title": "整理 MCP 评审", "unassigned": true}]}}`
  - 响应：`{"dryRun": true, "projectKey": "KB", "sprintName": "Sprint 1", "preview": [{"index": 0, "title": "修复助手面板 SSE 断流", "type": "TASK", "points": 1.0, "assigneeName": "集成甲", "epicName": null, "description": "线上反馈：长回复时断开"}, {"index": 1, "title": "助手支持语音输入", "type": "STORY", "points": 1.5, "assigneeName": "集成甲", "epicName": "支付重构", "description": null}, {"index": 2, "title": "看板拖拽偶发闪回", "type": "BUG", "points": null, "assigneeName": "李雷", "epicName": null, "description": null}, {"index": 3, "title": "整理 MCP 评审", "type": "TASK", "points": null, "assigneeName": null, "epicName": null, "description": null}], "created": [], "failed": []}`
- **create_tasks 真建**（HTTP 200 · ok · 118ms）
  - 请求：`{"tool": "create_tasks", "args": {"project_key": "KB", "sprint": "current", "tasks": [{"type": "TASK", "title": "修复助手面板 SSE 断流", "points": 1, "description": "线上反馈：长回复时断开"}, {"type": "STORY", "title": "助手支持语音输入", "points": 1.5, "epic_name": "支付重构"}, {"type": "BUG", "title": "看板拖拽偶发闪回", "assignee": "李雷"}, {"type": "TASK", "title": "整理 MCP 评审", "unassigned": true}]}}`
  - 响应：`{"dryRun": false, "projectKey": "KB", "sprintName": "Sprint 1", "preview": [{"index": 0, "title": "修复助手面板 SSE 断流", "type": "TASK", "points": 1.0, "assigneeName": "集成甲", "epicName": null, "description": "线上反馈：长回复时断开"}, {"index": 1, "title": "助手支持语音输入", "type": "STORY", "points": 1.5, "assigneeName": "集成甲", "epicName": "支付重构", "description": null}, {"index": 2, "title": "看板拖拽偶发闪回", "type": "BUG", "points": null, "assigneeName": "李雷", "epicName": null, "description": null}, {"index": 3, "title": "整理 MCP 评审", "type": "TASK", "points": null, "assigneeName": null, "epicName": null, "description": null}], "created": [{"index": 0, "displayKey": "KB-1", "title": "修复助手面板 SSE 断流", "type": "TASK", "stat…`
- **后端核验 Sprint 1 任务**（HTTP 200）
  - 请求：`{"GET": "/projects/KB/sprints?withTasks=true"}`
  - 响应：`[{"displayKey": null, "title": "修复助手面板 SSE 断流", "type": "TASK", "points": 1.0, "assigneeId": 84, "epicId": null, "status": "TODO"}, {"displayKey": null, "title": "助手支持语音输入", "type": "STORY", "points": 1.5, "assigneeId": 84, "epicId": null, "status": "TODO"}, {"displayKey": null, "title": "看板拖拽偶发闪回", "type": "BUG", "points": null, "assigneeId": 85, "epicId": null, "status": "TODO"}, {"displayKey": null, "title": "整理 MCP 评审", "type": "TASK", "points": null, "assigneeId": null, "epicId": null, "status": "TODO"}]`
- **create_tasks 旧形参 projectKey/target**（HTTP 200 · ok · 29ms）
  - 请求：`{"tool": "create_tasks", "args": {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "旧形参建的待办任务"}]}}`
  - 响应：`{"dryRun": false, "projectKey": "KB", "sprintName": "待办", "preview": [{"index": 0, "title": "旧形参建的待办任务", "type": "TASK", "points": null, "assigneeName": "集成甲", "epicName": null, "description": null}], "created": [{"index": 0, "displayKey": "KB-5", "title": "旧形参建的待办任务", "type": "TASK", "status": "TODO"}], "failed": []}`
- **create_tasks 未知字段 fail-closed**（HTTP 200 · **isError** · 4ms）
  - 请求：`{"tool": "create_tasks", "args": {"project_key": "KB", "tasks": [{"type": "TASK", "title": "x", "assigneeId": 1}]}}`
  - 响应：`{"code": "VALIDATION", "message": "tasks.0.assigneeId: Extra inputs are not permitted"}`
  - 备注：期望 VALIDATION 而非静默丢弃

### 推进

- **update_task_status 旧名 taskSeq**（HTTP 200 · ok · 86ms）
  - 请求：`{"tool": "update_task_status", "args": {"taskSeq": "KB-1", "status": "IN_PROGRESS"}}`
  - 响应：`{"task": {"seq": 1, "displayKey": "KB-1", "type": "TASK", "title": "修复助手面板 SSE 断流", "description": "线上反馈：长回复时断开", "points": 1.0, "epicName": null, "sprintName": "Sprint 1", "assigneeName": "集成甲", "status": "IN_PROGRESS", "createdAt": "2026-09-25T16:03:39.175484Z", "updatedAt": "2026-09-25T16:03:39.324706Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}}`
- **update_task_status 新名 task_key**（HTTP 200 · ok · 67ms）
  - 请求：`{"tool": "update_task_status", "args": {"task_key": "KB-2", "status": "COMPLETED"}}`
  - 响应：`{"task": {"seq": 2, "displayKey": "KB-2", "type": "STORY", "title": "助手支持语音输入", "description": null, "points": 1.5, "epicName": "支付重构", "sprintName": "Sprint 1", "assigneeName": "集成甲", "status": "COMPLETED", "createdAt": "2026-09-25T16:03:39.196428Z", "updatedAt": "2026-09-25T16:03:39.398107Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}}`
- **update_task_status 小写 done**（HTTP 200 · ok · 62ms）
  - 请求：`{"tool": "update_task_status", "args": {"task_key": "KB-1", "status": "COMPLETED"}}`
  - 响应：`{"task": {"seq": 1, "displayKey": "KB-1", "type": "TASK", "title": "修复助手面板 SSE 断流", "description": "线上反馈：长回复时断开", "points": 1.0, "epicName": null, "sprintName": "Sprint 1", "assigneeName": "集成甲", "status": "COMPLETED", "createdAt": "2026-09-25T16:03:39.175484Z", "updatedAt": "2026-09-25T16:03:39.462937Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}}`
- **add_comment**（HTTP 200 · ok · 40ms）
  - 请求：`{"tool": "add_comment", "args": {"task_key": "KB-1", "body": "已和产品确认方案"}}`
  - 响应：`{"comment": {"body": "已和产品确认方案", "createdAt": "2026-09-25T16:03:39.514234Z", "authorName": "集成甲"}}`
- **create_subtask**（HTTP 200 · ok · 33ms）
  - 请求：`{"tool": "create_subtask", "args": {"task_key": "KB-1", "title": "补单测"}}`
  - 响应：`{"subtask": {"title": "补单测", "done": false, "createdAt": "2026-09-25T16:03:39.556844Z"}}`
- **update_task**（HTTP 200 · ok · 58ms）
  - 请求：`{"tool": "update_task", "args": {"task_key": "KB-2", "points": 2, "assignee": "李雷"}}`
  - 响应：`{"task": {"seq": 2, "displayKey": "KB-2", "type": "STORY", "title": "助手支持语音输入", "description": null, "points": 2.0, "epicName": "支付重构", "sprintName": "Sprint 1", "assigneeName": "李雷", "status": "COMPLETED", "createdAt": "2026-09-25T16:03:39.196428Z", "updatedAt": "2026-09-25T16:03:39.596896Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}}`
- **move_task_to_sprint next**（HTTP 200 · ok · 60ms）
  - 请求：`{"tool": "move_task_to_sprint", "args": {"task_key": "KB-4", "sprint": "next"}}`
  - 响应：`{"task": {"seq": 4, "displayKey": "KB-4", "type": "TASK", "title": "整理 MCP 评审", "description": null, "points": null, "epicName": null, "sprintName": "Sprint 2", "assigneeName": null, "status": "TODO", "createdAt": "2026-09-25T16:03:39.221908Z", "updatedAt": "2026-09-25T16:03:39.656478Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}}`

### 日报

- **list_my_work all done_since=2026-09-26**（HTTP 200 · ok · 64ms）
  - 请求：`{"tool": "list_my_work", "args": {"scope": "all", "done_since": "2026-09-26"}}`
  - 响应：`{"scope": "all", "projects": ["KB"], "count": 0, "tasks": []}`
- **list_my_work current**（HTTP 200 · ok · 43ms）
  - 请求：`{"tool": "list_my_work", "args": {"scope": "current"}}`
  - 响应：`{"scope": "current", "projects": ["KB"], "count": 1, "tasks": [{"displayKey": "KB-1", "projectKey": "KB", "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "assigneeName": "集成甲", "sprintName": "Sprint 1", "epicName": null, "doneAt": null, "updatedAt": "2026-09-25T16:03:39.462937Z", "description": "线上反馈：长回复时断开", "subtaskDone": 0, "subtaskTotal": 1}]}`
- **get_task**（HTTP 200 · ok · 54ms）
  - 请求：`{"tool": "get_task", "args": {"task_key": "KB-1"}}`
  - 响应：`{"task": {"seq": 1, "displayKey": "KB-1", "type": "TASK", "title": "修复助手面板 SSE 断流", "description": "线上反馈：长回复时断开", "points": 1.0, "epicName": null, "sprintName": "Sprint 1", "assigneeName": "集成甲", "status": "COMPLETED", "createdAt": "2026-09-25T16:03:39.175484Z", "updatedAt": "2026-09-25T16:03:39.462937Z", "doneAt": null, "remindAt": null, "reminderDismissed": false}, "subtasks": [{"title": "补单测", "done": false, "createdAt": "2026-09-25T16:03:39.556844Z"}], "comments": [{"authorName": "集成甲", "body": "已和产品确认方案", "createdAt": "2026-09-25T16:03:39.514234Z"}]}`
- **list_my_tasks 旧名 current**（HTTP 200 · ok · 47ms）
  - 请求：`{"tool": "list_my_tasks", "args": {"projectKey": "KB", "sprint": "current"}}`
  - 响应：`{"projectKey": "KB", "sprint": "current", "tasks": [{"seq": "KB-1", "displayKey": "KB-1", "projectKey": "KB", "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "assigneeName": "集成甲", "sprintName": "Sprint 1", "epicName": null, "doneAt": null, "updatedAt": "2026-09-25T16:03:39.462937Z", "description": "线上反馈：长回复时断开", "subtaskDone": 0, "subtaskTotal": 1}]}`
- **get_board current**（HTTP 200 · ok · 24ms）
  - 请求：`{"tool": "get_board", "args": {"project_key": "KB", "sprint": "current"}}`
  - 响应：`{"projectKey": "KB", "sprint": {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}, "daysLeft": 13, "columns": {"TODO": [{"seq": 3, "title": "看板拖拽偶发闪回", "type": "BUG", "status": "TODO", "points": null, "assigneeName": "李雷", "description": null, "displayKey": "KB-3"}], "IN_PROGRESS": [], "COMPLETED": [{"seq": 1, "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "assigneeName": "集成甲", "description": "线上反馈：长回复时断开", "displayKey": "KB-1"}, {"seq": 2, "title": "助手支持语音输入", "type": "STORY", "status": "COMPLETED", "points": 2.0, "assigneeName": "李雷", "description": null, "displayKey": "KB-2"}], "DONE": []}}`
- **search_tasks**（HTTP 200 · ok · 23ms）
  - 请求：`{"tool": "search_tasks", "args": {"q": "SSE"}}`
  - 响应：`{"hits": [{"seq": 1, "displayKey": "KB-1", "projectKey": "KB", "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "description": "线上反馈：长回复时断开", "assigneeName": "集成甲"}]}`
- **list_members**（HTTP 200 · ok · 12ms）
  - 请求：`{"tool": "list_members", "args": {}}`
  - 响应：`{"members": [{"displayName": "集成甲", "email": "mcp-e251ba07@example.com", "role": "ADMIN"}, {"displayName": "李雷", "email": "mcp-e251ba07-b@example.com", "role": "MEMBER"}]}`
- **list_sprints 旧名**（HTTP 200 · ok · 19ms）
  - 请求：`{"tool": "list_sprints", "args": {"projectKey": "KB"}}`
  - 响应：`{"projectKey": "KB", "sprints": [{"name": "Sprint 2", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "PLANNED"}, {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}]}`
- **list_epics 旧名**（HTTP 200 · ok · 16ms）
  - 请求：`{"tool": "list_epics", "args": {"projectKey": "KB"}}`
  - 响应：`{"projectKey": "KB", "epics": [{"name": "支付重构", "description": null, "quarter": "2026-Q4", "color": null, "status": "OPEN"}]}`

### 资源

- **read pm://me/work**（HTTP 200）
  - 请求：`{"uri": "pm://me/work"}`
  - 响应：`{"scope": "all", "projects": ["KB"], "count": 2, "tasks": [{"displayKey": "KB-1", "projectKey": "KB", "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "assigneeName": "集成甲", "sprintName": "Sprint 1", "epicName": null, "doneAt": null, "updatedAt": "2026-09-25T16:03:39.462937Z", "description": "线上反馈：长回复时断开", "subtaskDone": 0, "subtaskTotal": 1}, {"displayKey": "KB-5", "projectKey": "KB", "title": "旧形参建的待办任务", "type": "TASK", "status": "TODO", "points": null, "assigneeName": "集成甲", "sprintName": null, "epicName": null, "doneAt": null, "updatedAt": "2026-09-25T16:03:`
- **read pm://projects/KB/sprints/current**（HTTP 200）
  - 请求：`{}`
  - 响应：`{"projectKey": "KB", "sprint": {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}, "daysLeft": 13, "columns": {"TODO": [{"seq": 3, "title": "看板拖拽偶发闪回", "type": "BUG", "status": "TODO", "points": null, "assigneeName": "李雷", "description": null, "displayKey": "KB-3"}], "IN_PROGRESS": [], "COMPLETED": [{"seq": 1, "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "COMPLETED", "points": 1.0, "assigneeName": "集成甲", "description": "线上反馈：长回复时断开", "displayKey": "KB-1"}, {"seq": 2, "title": "助手支持语音输入", "type": "STORY", "status": "COMPLETED"`
- **prompts/get daily_report**（HTTP 200）
  - 请求：`{"project_key": "KB"}`
  - 响应：`["请帮我写今天的日报。步骤：\n1. 调 list_my_work(scope=\"current\", project_key=\"KB\") 取我在当前迭代的任务；再调 list_my_work(scope=\"all\", project_key=\"KB\", done_since=\"今天的日期\") 找出今天完成的任务。\n2. 归组：doneAt 是今天的或状态 COMPLETED/DONE → 今日完成；IN_PROGRESS → 进行中（进展用 description 摘要、子任务进度 subtaskDone/subtaskTotal，需要更多细节再 get_task 看评论）；TODO → 待办 /"]`

### L3

- **close_sprint 无 confirm**（HTTP 200 · **isError** · 4ms）
  - 请求：`{"tool": "close_sprint", "args": {"project_key": "KB", "sprint": "current", "unfinished": "move", "target_sprint": "next"}}`
  - 响应：`{"code": "VALIDATION", "message": "confirm: Field required"}`
  - 备注：期望 CONFIRM_REQUIRED
- **close_sprint confirm=false**（HTTP 200 · **isError** · 4ms）
  - 请求：`{"tool": "close_sprint", "args": {"project_key": "KB", "sprint": "current", "unfinished": "move", "target_sprint": "next", "confirm": false}}`
  - 响应：`{"code": "CONFIRM_REQUIRED", "message": "该操作不可逆：请先把影响展示给用户，取得明确同意后带 confirm=true 重新调用"}`
  - 备注：期望 CONFIRM_REQUIRED
- **close_sprint confirm=true**（HTTP 200 · ok · 36ms）
  - 请求：`{"tool": "close_sprint", "args": {"project_key": "KB", "sprint": "current", "unfinished": "move", "target_sprint": "next", "confirm": true}}`
  - 响应：`{"sprint": {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "CLOSED"}}`
- **后端核验迭代状态**（HTTP 200）
  - 请求：`{"GET": "/projects/KB/sprints"}`
  - 响应：`[{"name": "Sprint 2", "status": "PLANNED", "startDate": "2026-09-26", "endDate": "2026-10-09"}, {"name": "Sprint 1", "status": "CLOSED", "startDate": "2026-09-26", "endDate": "2026-10-09"}]`
- **start_sprint 无 confirm**（HTTP 200 · **isError** · 4ms）
  - 请求：`{"tool": "start_sprint", "args": {"project_key": "KB", "sprint": "Sprint 2"}}`
  - 响应：`{"code": "VALIDATION", "message": "confirm: Field required"}`
  - 备注：期望 CONFIRM_REQUIRED
- **start_sprint confirm=true**（HTTP 200 · ok · 24ms）
  - 请求：`{"tool": "start_sprint", "args": {"project_key": "KB", "sprint": "Sprint 2", "confirm": true}}`
  - 响应：`{"sprint": {"name": "Sprint 2", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}}`
- **list_my_work previous**（HTTP 200 · ok · 32ms）
  - 请求：`{"tool": "list_my_work", "args": {"scope": "previous", "project_key": "KB"}}`
  - 响应：`{"scope": "previous", "projects": ["KB"], "count": 0, "tasks": []}`

### 错误

- **get_task NOT_FOUND**（HTTP 200 · **isError** · 30ms）
  - 请求：`{"tool": "get_task", "args": {"task_key": "KB-999"}}`
  - 响应：`{"code": "NOT_FOUND", "message": "任务 KB-999 不存在，可用 search_tasks 查找"}`
- **update_task_status 非法状态**（HTTP 200 · **isError** · 4ms）
  - 请求：`{"tool": "update_task_status", "args": {"task_key": "KB-1", "status": "CLOSED"}}`
  - 响应：`{"code": "VALIDATION", "message": "status: Input should be 'TODO', 'IN_PROGRESS', 'COMPLETED' or 'DONE'"}`
- **list_sprints 项目不存在**（HTTP 200 · **isError** · 14ms）
  - 请求：`{"tool": "list_sprints", "args": {"projectKey": "NOPE"}}`
  - 响应：`{"code": "NOT_FOUND", "message": "项目 NOPE 不存在，可用 list_projects 查看"}`

### 协议错误

- **假 PAT → 401**（HTTP 401 · 5ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer pmt_f…", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "raw", "version": "0"}}}}`
  - 响应：`{"code":"UNAUTHENTICATED","message":"authentication required"}`
  - 备注： 堆栈泄露=False content-type=application/json;charset=ISO-8859-1
- **无 Authorization → 401**（HTTP 401 · 2ms）
  - 请求：`{"method": "POST", "headers": {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "raw", "version": "0"}}}}`
  - 响应：`{"code":"UNAUTHENTICATED","message":"authentication required"}`
  - 备注： 堆栈泄露=False content-type=application/json;charset=ISO-8859-1
- **浏览器 JWT 打 /mcp → 401**（HTTP 401 · 4ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer eyJhb…", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "raw", "version": "0"}}}}`
  - 响应：`{"message":"personal access token required","code":"UNAUTHENTICATED"}`
  - 备注： 堆栈泄露=False content-type=application/json
- **GET /mcp 缺 session → 405**（HTTP 405 · 4ms）
  - 请求：`{"method": "GET", "headers": {"Authorization": "Bearer pmt_u…", "Accept": "text/event-stream"}, "body": null}`
  - 响应：`{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not allowed: /mcp only accepts POST (stateless Streamable HTTP)"}}`
  - 备注： 堆栈泄露=False content-type=application/json
- **DELETE /mcp → 405**（HTTP 405 · 4ms）
  - 请求：`{"method": "DELETE", "headers": {"Authorization": "Bearer pmt_u…"}, "body": null}`
  - 响应：`{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not allowed: /mcp only accepts POST (stateless Streamable HTTP)"}}`
  - 备注： 堆栈泄露=False content-type=application/json
- **POST tools/call 无 session 头（无状态应可用）**（HTTP 200 · 12ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer pmt_u…", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_projects", "arguments": {}}}}`
  - 响应：`{"jsonrpc":"2.0","id":2,"result":{"content":[{"text":"{\"projects\": [{\"key\": \"KB\", \"name\": \"看板项目\", \"defaultSprintLength\": \"WEEK_2\", \"autoRotate\": true}]}","type":"text"}],"isError":false,"structuredContent":{"projects":[{"key":"KB","name":"看板项目","defaultSprintLength":"WEEK_2","autoRotate":true}]}}}`
  - 备注： 堆栈泄露=False content-type=application/json
- **POST 坏 Accept → 4xx 无堆栈**（HTTP 406 · 5ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer pmt_u…", "Content-Type": "application/json", "Accept": "text/plain"}, "body": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "raw", "version": "0"}}}}`
  - 响应：`{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Not Acceptable: Client must accept application/json"}}`
  - 备注： 堆栈泄露=False content-type=application/json
- **POST 坏 JSON 体**（HTTP 400 · 5ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer pmt_u…", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": null}`
  - 响应：`{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error: EOF while parsing a value at line 1 column 0"}}`
  - 备注： 堆栈泄露=False content-type=application/json
- **POST 未知 Mcp-Session-Id**（HTTP 200 · 7ms）
  - 请求：`{"method": "POST", "headers": {"Authorization": "Bearer pmt_u…", "Mcp-Session-Id": "nope", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, "body": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "raw", "version": "0"}}}}`
  - 响应：`{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"experimental":{},"prompts":{"listChanged":false},"resources":{"listChanged":false,"subscribe":false},"tools":{"listChanged":false}},"instructions":"跬步（Kuibu）项目管理：任务 / 迭代（Sprint）/ 长期计划（Epic）/ 待办（Backlog）。任务用展示号指代（如 XX-0），项目用 key；负责人、迭代、长期计划一律用名称，工具不接受也不返回内部 id。先 list_projects 拿 project_key；写日报/周报用 list_my_work（缺省跨项目）。创建任务：先 create_tasks(dry_run=true) 拿预览，向用户展示清单并确认后再正式创建，单次不超过 20 条。close_sprint / start_sprint 不可逆：先向用户展示影响并取得明确同意，再带 confirm=true 调用。天数（points）0.5-5、步进 0.5，不确定就留空。失败返回 {code, message}：NOT_FOUND 先核对 key/展示号，AMBIGUOUS 从 candidates 里选一个再调。","protocolVersion":"2025-06-18","serverInfo":{"name":"kuibu","title":"跬步项目管理","version":""}}}`
  - 备注： 堆栈泄露=False content-type=application/json

## 修复后补验（同租户，新 PAT；`mcp_e2e_followup.py`）

- **close_sprint 漏传 confirm（修复后）**（isError · 11ms）
  - 请求：`{"tool": "close_sprint", "args": {"project_key": "KB", "sprint": "current", "unfinished": "backlog"}}`
  - 响应：`{"code": "CONFIRM_REQUIRED", "message": "该操作不可逆：请先把影响展示给用户，取得明确同意后带 confirm=true 重新调用"}`
- **start_sprint 漏传 confirm（修复后）**（isError · 6ms）
  - 请求：`{"tool": "start_sprint", "args": {"project_key": "KB", "sprint": "Sprint 2"}}`
  - 响应：`{"code": "CONFIRM_REQUIRED", "message": "该操作不可逆：请先把影响展示给用户，取得明确同意后带 confirm=true 重新调用"}`
- **close_sprint 缺 unfinished 仍是 VALIDATION**（isError · 4ms）
  - 请求：`{"tool": "close_sprint", "args": {"project_key": "KB", "sprint": "current", "confirm": true}}`
  - 响应：`{"code": "VALIDATION", "message": "unfinished: Field required"}`
- **update_task_status KB-1 DONE**（ok · 92ms）
  - 请求：`{"tool": "update_task_status", "args": {"task_key": "KB-1", "status": "DONE"}}`
  - 响应：`{"task": {"seq": 1, "displayKey": "KB-1", "type": "TASK", "title": "修复助手面板 SSE 断流", "description": "线上反馈：长回复时断开", "points": 1.0, "epicName": null, "sprintName": "Sprint 2", "assigneeName": "集成甲", "status": "DONE", "createdAt": "2026-09-25T16:03:39.175484Z", "updatedAt": "2026-09-25T16:05:41.393256Z", "doneAt": "2026-09-25T16:05:41.391247Z", "remindAt": null, "reminderDismissed": false}}`
- **list_my_work all done_since=2026-09-26**（ok · 84ms）
  - 请求：`{"tool": "list_my_work", "args": {"scope": "all", "done_since": "2026-09-26"}}`
  - 响应：`{"scope": "all", "projects": ["KB"], "count": 1, "tasks": [{"displayKey": "KB-1", "projectKey": "KB", "title": "修复助手面板 SSE 断流", "type": "TASK", "status": "DONE", "points": 1.0, "assigneeName": "集成甲", "sprintName": "Sprint 2", "epicName": null, "doneAt": "2026-09-25T16:05:41.391247Z", "updatedAt": "2026-09-25T16:05:41.393256Z", "description": "线上反馈：长回复时断开", "subtaskDone": 0, "subtaskTotal": 1}]}`
- **list_my_work all done_since=2099-01-01**（ok · 73ms）
  - 请求：`{"tool": "list_my_work", "args": {"scope": "all", "done_since": "2099-01-01"}}`
  - 响应：`{"scope": "all", "projects": ["KB"], "count": 0, "tasks": []}`
- **list_my_work done_since 格式错**（isError · 4ms）
  - 请求：`{"tool": "list_my_work", "args": {"done_since": "today"}}`
  - 响应：`{"code": "VALIDATION", "message": "done_since: Value error, 日期格式应为 yyyy-MM-dd"}`
- **get_project_overview 关闭后**（ok · 30ms）
  - 请求：`{"tool": "get_project_overview", "args": {"project_key": "KB"}}`
  - 响应：`{"projectKey": "KB", "projectName": "看板项目", "currentSprint": {"name": "Sprint 2", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "ACTIVE"}, "nextSprint": null, "lastClosedSprint": {"name": "Sprint 1", "length": "WEEK_2", "startDate": "2026-09-26", "endDate": "2026-10-09", "status": "CLOSED"}, "counts": {"TODO": 2, "IN_PROGRESS": 0, "COMPLETED": 1, "DONE": 1}, "donePct": 33.33, "epics": [{"name": "支付重构", "description": null, "quarter": "2026-Q4", "color": null, "status": "OPEN"}]}`
- **list_my_tasks previous 旧名**（ok · 32ms）
  - 请求：`{"tool": "list_my_tasks", "args": {"projectKey": "KB", "sprint": "previous"}}`
  - 响应：`{"projectKey": "KB", "sprint": "previous", "tasks": []}`
- **start_sprint 已有 ACTIVE → 业务 409**（isError · 24ms）
  - 请求：`{"tool": "start_sprint", "args": {"project_key": "KB", "sprint": "Sprint 2", "confirm": true}}`
  - 响应：`{"code": "SPRINT_NOT_PLANNED", "message": "only a PLANNED sprint can be started"}`

## 观察与遗留（未改代码，交编排者定夺）

1. `close_sprint(unfinished=move)` 把 COMPLETED 也当「未完成」搬走：后端语义是只有 DONE 算完成，与 SKILL.md 日报模板「COMPLETED/DONE → 今日完成」的口径不同；工具描述可再点明「未完成 = 非 DONE」。
2. 新建迭代缺省 `startDate = 今天`，Sprint 2 与刚关闭的 Sprint 1 起止完全相同（语义测试 C6 已记录，后端 `SprintService` 缺省值问题）。
3. `start_sprint` 对非 PLANNED 迭代的后端消息为英文 `only a PLANNED sprint can be started`（审查 P2「后端英文错误直出」范围）。
4. `GET /projects/KB/sprints?withTasks=true` 的迭代内任务视图没有 `displayKey`（核验时取到 null），只影响本记录的后端核验列，不影响 MCP 输出。
5. SKILL.md 开头写「共 14 个新工具 + 6 个旧名兼容」，表格实际 15 个新工具（读 7 / L1 3 / L2 3 / L3 2）+ 3 个独立旧名，本次未改文案。

# 自然语言助手（LangGraph ReAct 智能体）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在跬步里加一个「助手」面板，用户用自然语言完成全部项目操作；修改/删除/状态变更必须经确认卡，创建直接执行并回显可撤销。

**Architecture:** 前端面板 → Java 反代 `/api/t/{slug}/assistant/**`（JWT 与租户已校验，注入 header）→ 本机 Python 服务（FastAPI + 手写 LangGraph `StateGraph`：reason → guard(interrupt) → act → observe → reason）→ 以用户 JWT 回调现有 REST。Python 不做权限，只做 harness（分级、审批、重试、限流、审计、兜底）。

**Tech Stack:** Python 3.12 + uv；langgraph 1.2.x、langgraph-checkpoint-postgres 3.x、openai SDK 3.x、fastapi、httpx、pydantic-settings、pytest；Java 21 / Spring Boot 3.3；React 19 + TanStack Query。

**Spec:** `docs/superpowers/specs/2026-09-24-nl-assistant-agent-design.md`

## Global Constraints

- 只用 LangGraph（`StateGraph` / `interrupt` / `Command` / checkpointer）；**不 import `langchain` / `langchain_openai` / `langchain_core`**（CI 用 grep 断言）。模型调用用 `openai.AsyncOpenAI`。
- 工具名满足 `^[a-zA-Z0-9_-]+$`；工具入参只接受展示号（`PM-12`）、名称、枚举，**没有 slug / tenant / 内部 id 参数**。
- 风险等级 fail-closed：每个工具必须显式声明 `L0|L1|L2|L3`，未声明启动即 `RuntimeError`。
- L2/L3 在 guard 节点 `interrupt()`；act 节点执行前再次核对"该 callId 有 approve/edit 决策"；模型文本永远不能充当决策。
- 写操作（POST/PATCH/PUT/DELETE）**不自动重试**；GET 连接错误/5xx 最多重试 2 次。
- 所有上限（`MAX_TOOL_ROUNDS=15`、`MAX_TOKENS_PER_RUN=60000`、`RUN_TIMEOUT_SECONDS=90`、`CARD_TTL_SECONDS=600`）只从 `settings.py` 读，模块内不写第二份常量。
- SSE 事件与 HTTP JSON 一律 camelCase；Python 内部 snake_case，只在 `schemas.py` 的 `to_wire()` 一处转换。
- Java 反代注入 `X-PM-Tenant`（slug）、`X-PM-User`（userId）、透传 `Authorization`；Python 回调 Java 带 `X-PM-Source: AGENT`。
- 凭证只在 `agent/.env`（gitignored）；模型 ID `DeepSeek-V4.1-Flash`（大小写敏感）；`temperature=0`。
- 中文注释、中文提交信息（`feat(agent): …` / `feat(backend): …` / `feat(frontend): …`）。
- 本机构建：`export JAVA_HOME=/opt/homebrew/opt/openjdk@21`，Maven 用 `-s /tmp/mvn-settings.xml -o`（`printf '<settings/>' > /tmp/mvn-settings.xml`）。前端命令在 `frontend/` 下执行。

## Review Focus

1. **同一轮多张确认卡部分拒绝**：用户拒了第 1 张、批了第 2 张 → 只执行第 2 张，第 1 张回给模型"用户拒绝"，模型不得重发同一调用。测试在 Task 6。
2. **确认卡过期后 resume**：10 分钟后提交 approve → 拒绝执行，返回 `CARD_EXPIRED`，模型收到"已过期"观察。测试在 Task 6。
3. **展示号属于其他项目/不存在/多义名称**：`PM-99` 不存在 → `NOT_FOUND` 工具错误且不猜；成员名"张"匹配 2 人 → 返回候选让模型追问。测试在 Task 3。
4. **thread 归属伪造**：用别人的 threadId（前缀 tenant/user 不匹配 header）→ 404，不泄露存在性。测试在 Task 7。
5. **非 JWT 请求伪造 `X-PM-Source: AGENT`**：PAT/MCP 请求带该 header 也不能记成 AGENT。测试在 Task 8。

---

## 文件结构

```
agent/                                   # 新增（Task 1-7）
├── pyproject.toml  .env.example  README.md
├── app/
│   ├── main.py            # FastAPI app、生命周期（checkpointer/审计表 setup）、路由
│   ├── settings.py        # pydantic-settings 唯一配置源
│   ├── state.py           # AgentState TypedDict
│   ├── schemas.py         # Card / Decision / SSE 事件 pydantic 模型 + to_wire()
│   ├── prompts.py         # 系统提示 + 术语表
│   ├── graph.py           # build_graph(deps) → CompiledStateGraph
│   ├── nodes/{reason,guard,act,observe}.py
│   ├── harness/{auth,tool_guard,approval,retry,limiter,audit,fallback}.py
│   ├── tools/{_client,_resolve,tasks,sprints,epics,projects,subtasks,comments,records,members,notifications}.py
│   └── api/{threads,sse}.py
└── tests/…
backend/src/main/java/pm/assistant/AssistantProxyController.java   # Task 8
backend/src/main/java/pm/task/Activity.java (+AGENT)               # Task 8
backend/src/main/java/pm/task/ActivityRecorder.java / TaskService (source 判定)  # Task 8
frontend/src/assistant/{AssistantPanel,ConfirmCard,ResultCard,ErrorCard,useAssistant,sse,types,voice}.tsx|ts  # Task 9
frontend/src/components/Layout.tsx（顶栏按钮 + ⌘J）                  # Task 9
deploy/pm-agent.service  deploy/build.sh  deploy/deploy.sh  deploy/remote-setup.sh  # Task 7
```

任务依赖：Task 1 → {2, 3} → {4, 5} → 6 → 7；Task 8（Java）与 Task 9（前端）只依赖本文件里的契约，可与 Task 1-7 并行；Task 10 集成验证依赖全部。

---

### Task 1: Python 工程骨架、settings、ToolGuard 注册表（fail-closed）

**Files:**
- Create: `agent/pyproject.toml`, `agent/.env.example`, `agent/app/__init__.py`, `agent/app/settings.py`, `agent/app/harness/__init__.py`, `agent/app/harness/tool_guard.py`, `agent/app/harness/auth.py`, `agent/tests/conftest.py`, `agent/tests/test_tool_guard.py`, `agent/tests/test_no_langchain.py`
- Modify: `.gitignore`（加 `agent/.env`、`agent/.venv/`、`agent/__pycache__/`）

**Interfaces (Produces):**
```python
# app/settings.py
class Settings(BaseSettings):
    llm_base_url: str; llm_api_key: str; llm_model: str = "DeepSeek-V4.1-Flash"
    pm_api_url: str = "http://127.0.0.1:8080"
    agent_db_url: str          # postgresql://pm:pm@localhost:5432/pm
    agent_db_schema: str = "agent"
    max_tool_rounds: int = 15; max_tokens_per_run: int = 60000
    run_timeout_seconds: int = 90; card_ttl_seconds: int = 600
    llm_max_retries: int = 3; get_max_retries: int = 2
    thread_retention_days: int = 7
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")
def get_settings() -> Settings  # lru_cache

# app/harness/auth.py
@dataclass(frozen=True)
class RequestCtx: jwt: str; tenant: str; user_id: int; project_key: str | None; page: str | None
_ctx: ContextVar[RequestCtx | None]
def set_ctx(ctx: RequestCtx) -> Token; def reset_ctx(token) -> None
def current_ctx() -> RequestCtx   # 未设置抛 RuntimeError("no request context")

# app/harness/tool_guard.py
Risk = Literal["L0", "L1", "L2", "L3"]
@dataclass
class ToolSpec:
    name: str; risk: Risk; description: str
    params: type[BaseModel]; fn: Callable[..., Awaitable[Any]]   # async fn(params) -> dict
    editable: tuple[str, ...] = ()            # edit 决策允许改的字段
    escalate: Callable[[BaseModel, RequestCtx], Risk] | None = None
    summarize: Callable[[BaseModel, dict | None], str] | None = None  # 卡片标题
REGISTRY: dict[str, ToolSpec]
def pm_tool(*, name, risk, description, params, editable=(), escalate=None, summarize=None)  # 装饰器，注册；重名 → ValueError；name 不匹配正则 → ValueError
def effective_risk(spec: ToolSpec, args: BaseModel, ctx: RequestCtx) -> Risk   # max(spec.risk, escalate(...))
def needs_approval(risk: Risk) -> bool   # L2/L3
def openai_tools() -> list[dict]        # [{"type":"function","function":{name, description, parameters: params.model_json_schema()}}]
def assert_registry_complete(expected_names: set[str]) -> None   # 缺/多 → RuntimeError
```

- [ ] **Step 1: 建工程**

`agent/pyproject.toml`：
```toml
[project]
name = "pm-agent"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "langgraph>=1.2,<2", "langgraph-checkpoint-postgres>=3.1,<4", "psycopg[binary,pool]>=3.2",
  "openai>=3,<4", "fastapi>=0.115", "uvicorn[standard]>=0.30", "httpx>=0.27",
  "pydantic>=2.8", "pydantic-settings>=2.4", "sse-starlette>=2.1",
]
[dependency-groups]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "respx>=0.21", "httpx>=0.27"]
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
[tool.uv]
package = false
```
`agent/.env.example`：
```
LLM_BASE_URL=https://example.invalid/v1
LLM_API_KEY=replace-me
LLM_MODEL=DeepSeek-V4.1-Flash
PM_API_URL=http://127.0.0.1:8080
AGENT_DB_URL=postgresql://pm:pm@localhost:5432/pm
```
Run: `cd agent && uv sync` Expected: 生成 `uv.lock`、`.venv`。

- [ ] **Step 2: 写 fail-closed 测试（先失败）**

`agent/tests/test_tool_guard.py`：
```python
import pytest
from pydantic import BaseModel
from app.harness import tool_guard as tg
from app.harness.auth import RequestCtx

class P(BaseModel):
    task_key: str

@pytest.fixture(autouse=True)
def clean_registry():
    tg.REGISTRY.clear()
    yield
    tg.REGISTRY.clear()

def test_register_and_openai_schema():
    @tg.pm_tool(name="get_task", risk="L0", description="查任务", params=P)
    async def get_task(p: P): return {}
    assert tg.REGISTRY["get_task"].risk == "L0"
    tools = tg.openai_tools()
    assert tools[0]["function"]["name"] == "get_task"
    assert tools[0]["function"]["parameters"]["required"] == ["task_key"]

def test_bad_name_rejected():
    with pytest.raises(ValueError):
        @tg.pm_tool(name="tasks.get", risk="L0", description="x", params=P)
        async def f(p): ...

def test_duplicate_rejected():
    @tg.pm_tool(name="a", risk="L0", description="x", params=P)
    async def f1(p): ...
    with pytest.raises(ValueError):
        @tg.pm_tool(name="a", risk="L0", description="x", params=P)
        async def f2(p): ...

def test_registry_completeness_fail_closed():
    @tg.pm_tool(name="a", risk="L0", description="x", params=P)
    async def f1(p): ...
    with pytest.raises(RuntimeError):
        tg.assert_registry_complete({"a", "b"})   # b 缺
    with pytest.raises(RuntimeError):
        tg.assert_registry_complete(set())         # a 多

def test_escalate_raises_risk():
    ctx = RequestCtx(jwt="j", tenant="t", user_id=1, project_key="PM", page=None)
    @tg.pm_tool(name="create_task", risk="L1", description="x", params=P,
                escalate=lambda p, c: "L2" if p.task_key == "other" else "L1")
    async def f(p): ...
    spec = tg.REGISTRY["create_task"]
    assert tg.effective_risk(spec, P(task_key="mine"), ctx) == "L1"
    assert tg.effective_risk(spec, P(task_key="other"), ctx) == "L2"
    assert tg.needs_approval("L2") and tg.needs_approval("L3")
    assert not tg.needs_approval("L1")
```
`agent/tests/test_no_langchain.py`：
```python
import pathlib, re
def test_no_langchain_imports():
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    bad = [p for p in root.rglob("*.py") if re.search(r"^\s*(from|import)\s+langchain", p.read_text(), re.M)]
    assert bad == [], f"禁止 import langchain：{bad}"
```

- [ ] **Step 3: 跑测试确认失败** Run: `cd agent && uv run pytest -q` Expected: ImportError / FAIL。

- [ ] **Step 4: 实现 settings / auth / tool_guard**（按上方接口；`effective_risk` 取 `max` 按 `L0<L1<L2<L3` 排序；`openai_tools` 用 `params.model_json_schema()` 并删掉 `title`）。

- [ ] **Step 5: 跑测试通过** Run: `cd agent && uv run pytest -q` Expected: 6 passed。

- [ ] **Step 6: Commit** `git add agent .gitignore && git commit -m "feat(agent): 工程骨架 + settings + ToolGuard 注册表(fail-closed)"`

---

### Task 2: Java REST 客户端与错误映射、重试分类

**Files:**
- Create: `agent/app/tools/__init__.py`, `agent/app/tools/_client.py`, `agent/app/harness/retry.py`, `agent/tests/test_client.py`, `agent/tests/test_retry.py`

**Interfaces (Produces):**
```python
# app/harness/retry.py
class RetryClass(Enum): NONE, RETRY_GET_ONLY, RETRY_ALWAYS
def classify_http(status: int | None, method: str, exc: Exception | None) -> RetryClass
#  连接错误/超时/5xx: GET → RETRY_GET_ONLY(最多 settings.get_max_retries)，写 → NONE
#  401/403/404/400/409: NONE
def backoff_seconds(attempt: int) -> float   # 1, 2, 4
async def with_llm_retry(fn, *, max_retries) -> Any   # 429/5xx/连接错误重试；4xx 不重试；尊重 Retry-After

# app/tools/_client.py
class PmApiError(Exception): status: int; code: str; message: str
class PmClient:
    def __init__(self, ctx: RequestCtx, base_url: str | None = None, timeout: float = 15.0)
    async def get(path, params=None) -> Any
    async def post(path, json=None) -> Any; async def patch(path, json) -> Any
    async def put(path, json) -> Any; async def delete(path) -> None
    # path 相对 /api/t/{slug}，slug 只来自 ctx.tenant；自动带 Authorization 与 X-PM-Source: AGENT
    # 非 2xx → PmApiError(status, code, message)（解析 {code,message}，解析失败 code="HTTP_<status>"）
    # 204/空体 → None
def client() -> PmClient   # 用 current_ctx() 构造
```

- [ ] **Step 1: 写测试（respx 模拟 Java）**

`agent/tests/test_client.py`：
```python
import httpx, pytest, respx
from app.harness.auth import RequestCtx, set_ctx, reset_ctx
from app.tools._client import PmClient, PmApiError

CTX = RequestCtx(jwt="jwt1", tenant="acme", user_id=7, project_key="PM", page=None)

@respx.mock
async def test_headers_and_path():
    route = respx.get("http://pm/api/t/acme/projects").mock(return_value=httpx.Response(200, json=[{"key": "PM"}]))
    c = PmClient(CTX, base_url="http://pm")
    assert await c.get("/projects") == [{"key": "PM"}]
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer jwt1"
    assert req.headers["X-PM-Source"] == "AGENT"

@respx.mock
async def test_error_mapping():
    respx.patch("http://pm/api/t/acme/tasks/1").mock(return_value=httpx.Response(409, json={"code": "CONFLICT", "message": "x"}))
    with pytest.raises(PmApiError) as e:
        await PmClient(CTX, base_url="http://pm").patch("/tasks/1", json={"status": "DONE"})
    assert (e.value.status, e.value.code) == (409, "CONFLICT")

@respx.mock
async def test_get_retries_on_5xx_but_write_does_not():
    g = respx.get("http://pm/api/t/acme/members").mock(side_effect=[httpx.Response(502), httpx.Response(200, json=[])])
    assert await PmClient(CTX, base_url="http://pm").get("/members") == []
    assert g.call_count == 2
    p = respx.post("http://pm/api/t/acme/projects/PM/tasks").mock(return_value=httpx.Response(502))
    with pytest.raises(PmApiError):
        await PmClient(CTX, base_url="http://pm").post("/projects/PM/tasks", json={})
    assert p.call_count == 1

@respx.mock
async def test_empty_body_returns_none():
    respx.delete("http://pm/api/t/acme/tasks/1").mock(return_value=httpx.Response(204))
    assert await PmClient(CTX, base_url="http://pm").delete("/tasks/1") is None
```
`agent/tests/test_retry.py`：
```python
import httpx
from app.harness.retry import classify_http, RetryClass, backoff_seconds
def test_classify():
    assert classify_http(502, "GET", None) == RetryClass.RETRY_GET_ONLY
    assert classify_http(502, "POST", None) == RetryClass.NONE
    assert classify_http(None, "GET", httpx.ConnectError("x")) == RetryClass.RETRY_GET_ONLY
    for s in (400, 401, 403, 404, 409):
        assert classify_http(s, "GET", None) == RetryClass.NONE
    assert [backoff_seconds(i) for i in range(3)] == [1, 2, 4]
```

- [ ] **Step 2: 跑测试确认失败** Run: `cd agent && uv run pytest tests/test_client.py tests/test_retry.py -q`
- [ ] **Step 3: 实现**（`PmClient` 用 `httpx.AsyncClient`；重试循环里 `await asyncio.sleep(backoff_seconds(i))`，测试用 `monkeypatch` 把 sleep 换成 no-op 或把 backoff 设为 0）。
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit** `git commit -m "feat(agent): Java REST 客户端 + 错误映射 + 重试分类"`

---

### Task 3: 展示号/名称解析与工具目录（L0-L3 全部工具）

**Files:**
- Create: `agent/app/tools/_resolve.py`, `agent/app/tools/tasks.py`, `sprints.py`, `epics.py`, `projects.py`, `subtasks.py`, `comments.py`, `records.py`, `members.py`, `notifications.py`, `agent/app/tools/catalog.py`, `agent/tests/test_resolve.py`, `agent/tests/test_tools_catalog.py`, `agent/tests/fixtures/*.json`

**Interfaces (Produces):**
```python
# app/tools/_resolve.py
class NotFound(Exception): message: str          # "任务 PM-99 不存在，可用 search_tasks 查找"
class Ambiguous(Exception): candidates: list[str] # "成员「张」匹配多人：张三、张伟，请指明"
async def resolve_project_key(key: str | None) -> str        # None → ctx.project_key → 第一个项目
async def resolve_task(task_key: str) -> dict                # "PM-12" → GET /projects/PM/... 找 seq=12（先 search q=PM-12，再校验 displayKey 完全相等）
async def resolve_sprint(ref: str, project_key: str) -> dict # "current"/"next"/"backlog"(返回 {"id": None})/名称
async def resolve_member(name: str) -> dict                  # 姓名或邮箱前缀，大小写不敏感；"me"/"我" → 当前用户
async def resolve_epic(name: str, project_key: str) -> dict
# app/tools/catalog.py
EXPECTED_TOOLS: set[str]   # 与 spec §8 完全一致的 33 个名字
def load_all() -> None      # import 各模块触发注册；assert_registry_complete(EXPECTED_TOOLS)
```

工具目录（每个工具：`name / risk / params 字段 / 调用`）——与 spec §8 一一对应：

| name | risk | params | 调用 |
|---|---|---|---|
| list_projects | L0 | — | GET /projects |
| get_dashboard | L0 | project_key? | GET /projects/{k}/dashboard |
| list_sprints | L0 | project_key?, with_tasks=false | GET /projects/{k}/sprints?withTasks= |
| get_board | L0 | project_key?, sprint="current" | resolve_sprint → GET /sprints/{id}/board |
| list_backlog | L0 | project_key? | GET /projects/{k}/backlog |
| list_my_tasks | L0 | project_key?, sprint: current/next/backlog | board 或 backlog 过滤 assigneeId==ctx.user_id |
| get_task | L0 | task_key | resolve_task + GET subtasks + comments |
| search_tasks | L0 | q | GET /tasks/search?q= |
| list_epics | L0 | project_key? | GET /projects/{k}/epics |
| list_members | L0 | — | GET /members |
| list_notifications | L0 | — | GET /notifications |
| create_task | L1，escalate: assignee 非本人→L2 | type(STORY/BUG/TASK), title, description?, points?(0.5-5 步 0.5), assignee?, epic_name?, sprint?(current/next/backlog) | POST /projects/{k}/tasks |
| create_subtask | L1 | task_key, title | POST /tasks/{id}/subtasks |
| add_comment | L1 | task_key, body | POST /tasks/{id}/comments |
| create_record | L1 | content, remind_at?(ISO) | POST /projects/{k}/tasks {type: RECORD, title: content 前 80 字, description: content, remindAt} |
| create_sprint | L1 | project_key?, name?, length?(WEEK_1/WEEK_2/MONTH_1), start_date? | POST /projects/{k}/sprints |
| create_epic | L1 | project_key?, name, quarter?, description? | POST /projects/{k}/epics |
| mark_notifications_read | L1 | — | POST /notifications/read-all |
| dismiss_record_reminder | L1 | record_key | POST /records/{id}/dismiss |
| update_task_status | L2, editable=(status,) | task_key, status | PATCH /tasks/{id} {status} |
| update_task | L2, editable=(title,description,points,assignee) | task_key, title?, description?, points?, assignee?, clear_assignee?, epic_name?, clear_epic? | PATCH /tasks/{id}（PatchLong：clear_* → 显式 null） |
| move_task_to_sprint | L2, editable=(sprint,) | task_key, sprint | PATCH /tasks/{id} {sprintId 或 null} |
| update_subtask | L2 | task_key, subtask_title, done?, new_title? | PATCH /subtasks/{id} |
| update_epic | L2 | project_key?, epic_name, name?, description?, quarter?, status? | PATCH /projects/{k}/epics/{id} |
| set_capacity | L2 | project_key?, sprint="current", member, capacity | PUT /sprints/{id}/capacity/{userId} |
| delete_task | L3 | task_key | DELETE /tasks/{id} |
| delete_subtask | L3 | task_key, subtask_title | DELETE /subtasks/{id} |
| delete_epic | L3 | project_key?, epic_name | DELETE /projects/{k}/epics/{id} |
| delete_sprint | L3 | project_key?, sprint_name | DELETE /sprints/{id} |
| start_sprint | L3 | project_key?, sprint_name | POST /sprints/{id}/start |
| close_sprint | L3 | project_key?, sprint="current", unfinished(backlog/move), target_sprint? | POST /sprints/{id}/close |
| invite_member | L3 | role(ADMIN/MEMBER) | POST /invites |
| remove_member | L3 | member | DELETE /members/{userId} |

每个 L2 工具必须实现 `summarize(params, before)`，返回卡片标题（如 `修改任务状态 PM-12「登录页」`），并在 `fn` 内**先 GET 现状**再 PATCH（guard 节点会单独调用 `before(params)` 取现状用于 diff，见 Task 5；工具模块导出 `async def before(params) -> dict`，L0/L1 不需要）。

完整示例（`tasks.py` 中 `update_task_status`）：
```python
class UpdateTaskStatusParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_key: str = Field(description="任务展示号，如 XX-0")
    status: Literal["TODO", "IN_PROGRESS", "COMPLETED", "DONE"]

async def _before_update_task_status(p: UpdateTaskStatusParams) -> dict:
    return await resolve_task(p.task_key)

@pm_tool(name="update_task_status", risk="L2", params=UpdateTaskStatusParams, editable=("status",),
         description="修改任务状态。完成/做完→COMPLETED；归档/验收通过→DONE；开始做→IN_PROGRESS；含糊时先问用户。",
         summarize=lambda p, before: f"修改任务状态 {p.task_key}「{(before or {}).get('title','')}」",
         before=_before_update_task_status)
async def update_task_status(p: UpdateTaskStatusParams) -> dict:
    t = await resolve_task(p.task_key)
    return await client().patch(f"/tasks/{t['id']}", json={"status": p.status})
```
（`pm_tool` 增加可选参数 `before`；Task 1 的 `ToolSpec` 加字段 `before: Callable | None = None`。）

- [ ] **Step 1: 写 resolve 测试（respx）**：`PM-12` 命中；`PM-99` → `NotFound`；`search` 返回 `PM-120` 与 `PM-12` 时只取 displayKey 完全相等；成员 "张" 匹配两人 → `Ambiguous`；`"我"` → 当前用户；`sprint="next"` 无 PLANNED → `NotFound("没有下一个迭代，可先 create_sprint")`。
- [ ] **Step 2: 写目录测试**：`load_all()` 后 `REGISTRY.keys() == EXPECTED_TOOLS`；每个 L2/L3 有 `summarize`；每个 L2 有 `before`；所有 params `extra="forbid"`；`openai_tools()` 里没有名为 `slug/tenant/id` 的参数（递归检查 properties 键）。
- [ ] **Step 3: 跑测试确认失败**
- [ ] **Step 4: 实现 `_resolve.py` 与全部工具模块 + `catalog.py`**（`create_task` 的 points 用 `Decimal` 且校验 0.5 步进；`update_task` 的 PatchLong 语义：`clear_assignee=True` → `"assigneeId": None` 显式放进 json，未提供的键不放）。
- [ ] **Step 5: 跑全部测试通过** Run: `cd agent && uv run pytest -q`
- [ ] **Step 6: Commit** `git commit -m "feat(agent): 展示号/名称解析 + 33 个工具目录"`

---

### Task 4: 状态、schemas、审批卡生成、提示词、reason 节点（假模型可测）

**Files:**
- Create: `agent/app/state.py`, `agent/app/schemas.py`, `agent/app/prompts.py`, `agent/app/harness/approval.py`, `agent/app/nodes/__init__.py`, `agent/app/nodes/reason.py`, `agent/app/llm.py`, `agent/tests/test_schemas.py`, `agent/tests/test_reason.py`, `agent/tests/fake_llm.py`

**Interfaces (Produces):**
```python
# app/state.py
class AgentState(TypedDict):
    messages: Annotated[list[dict], operator.add]   # OpenAI 格式：system/user/assistant/tool
    round: int
    decisions: dict[str, dict]      # callId → {"type": approve|edit|reject, "args"?: dict, "message"?: str}
    cards: dict[str, dict]          # callId → Card.model_dump()
    run_id: str
    tokens_used: int
    conflict_retries: dict[str, int]
    last_call_sigs: list[str]       # observe 用：f"{name}:{sorted args json}" 最近 3 条

# app/schemas.py
class FieldChange(BaseModel): field: str; label: str; before: Any; after: Any
class Card(BaseModel):
    call_id: str; tool: str; risk: Risk; title: str; target: str        # "PM-12 登录页接入短信验证"
    changes: list[FieldChange]; impact: str; editable: list[str]; args: dict
    expires_at: datetime; allowed_decisions: list[Literal["approve","edit","reject"]]
class Decision(BaseModel): call_id: str; type: Literal["approve","edit","reject"]; args: dict | None = None; message: str | None = None
class SseEvent(BaseModel): type: Literal["text_delta","tool_start","tool_result","confirm","result_card","done","error"]; ...按 spec §5.2
def to_wire(model: BaseModel) -> dict   # snake→camel 递归

# app/llm.py
class LLM(Protocol):
    async def chat(self, messages: list[dict], tools: list[dict]) -> dict   # 返回 assistant message dict（含 tool_calls 或 content），已剥离 reasoning；附 usage
def make_llm(settings) -> LLM   # openai.AsyncOpenAI(base_url, api_key)，temperature=0，with_llm_retry 包裹
# app/prompts.py
def system_prompt(ctx: RequestCtx, now: datetime) -> str   # 含术语表、执行纪律、示例 XX-0、<data> 规则、当前项目/页面
# app/harness/approval.py
async def build_card(spec: ToolSpec, args: BaseModel, call_id: str, ctx, now, ttl) -> Card
#  before = await spec.before(args)（若有）；changes = 对比 args 中提供的字段与 before 对应字段；target = displayKey + title
# app/nodes/reason.py
def make_reason_node(llm: LLM, tools: list[dict], settings) -> Callable[[AgentState], Awaitable[dict]]
#  1) 裁剪：保留 system + 最近 12 轮 + 所有含展示号的 tool 消息摘要
#  2) 调 llm.chat；3) 返回 {"messages":[assistant], "round": round+1, "tokens_used": +usage}
```

- [ ] **Step 1: 写测试**：`to_wire` 把 `call_id/expires_at` 变 `callId/expiresAt`；`build_card` 对 `update_task_status(PM-12, COMPLETED)` 且 before.status=IN_PROGRESS 生成一条 `FieldChange(field="status", before="IN_PROGRESS", after="COMPLETED")`，`allowed_decisions` 含 edit（L2）而 L3 不含；`reason` 节点用 `fake_llm.py`（`FakeLLM(scripted=[...])` 按顺序返回）产出 assistant 消息、round+1；`reason` 剥离 `reasoning` 字段；裁剪后 tool 消息里含 `PM-` 的摘要仍在。
- [ ] **Step 2: 确认失败 → Step 3: 实现 → Step 4: 通过**
- [ ] **Step 5: Commit** `git commit -m "feat(agent): 状态/schema/确认卡生成/提示词/reason 节点"`

---

### Task 5: guard / act / observe 节点与图组装

**Files:**
- Create: `agent/app/nodes/guard.py`, `agent/app/nodes/act.py`, `agent/app/nodes/observe.py`, `agent/app/harness/limiter.py`, `agent/app/graph.py`, `agent/tests/test_graph.py`

**Interfaces (Produces):**
```python
# app/harness/limiter.py
def call_signature(name: str, args: dict) -> str
def is_repeating(sigs: list[str], new: str, limit: int = 3) -> bool
def over_limits(state, settings) -> str | None   # "MAX_ROUNDS" | "MAX_TOKENS" | None
# app/nodes/guard.py  make_guard_node(settings, now_fn)
#   对 last assistant.tool_calls 逐个：解析 args → REGISTRY[name].params(**args)（失败 → decisions[id]={"type":"reject","message":"参数无效: …"}）
#   risk = effective_risk；若 needs_approval：card = build_card；cards[id]=card；
#   decision = interrupt(to_wire(card))   ← 每张卡一次 interrupt（LangGraph 顺序恢复）
#   decision 校验：type ∈ allowed；edit 的 args 只允许 editable 字段且重新过 params 校验；now > expires_at → reject "CARD_EXPIRED"
#   返回 {"decisions": {...}, "cards": {...}}
# app/nodes/act.py  make_act_node(settings)
#   对每个 tool_call：d = decisions.get(id, {"type":"approve"} 仅当 risk 为 L0/L1，否则必须存在决策，否则 reject)
#   approve/edit → 执行 fn（edit 用合并后的 args）；成功 → tool 消息 content=json(result)+ 结果卡标记；PmApiError → tool 消息 content=json({error:{code,message}})
#   reject → tool 消息 "用户拒绝了 <name>，未执行，除非用户再次要求否则不要重发"
#   并行执行 L0；写操作串行
# app/nodes/observe.py  make_observe_node(settings)
#   更新 last_call_sigs；409 → conflict_retries[id]+=1（≤1 则 goto guard 重出卡）；返回路由字段
# app/graph.py
def build_graph(*, llm: LLM, settings, checkpointer, now_fn=datetime.now) -> CompiledStateGraph
#   route_after_reason: tool_calls → "guard"；否则 END
#   route_after_observe: over_limits → END(附 error)；conflict → "guard"；否则 "reason"
```

- [ ] **Step 1: 写图测试**（InMemorySaver + FakeLLM + respx，全部不需要真模型）：
  1. 纯问答：FakeLLM 返回无 tool_calls → 一轮到 END，`messages[-1].role == "assistant"`。
  2. L0 直通：`list_projects` 调用不产生 interrupt，`get_state().next == ()`，tool 消息含结果。
  3. L2 必挂起：`update_task_status` → `get_state().next == ("guard",)`，interrupt payload 是 camelCase 卡片且 `changes[0].after == "COMPLETED"`。
  4. approve 后执行且仅执行一次：respx PATCH call_count == 1；再 invoke 同 thread 不重复。
  5. reject 后不执行：PATCH call_count == 0，tool 消息含"拒绝"。
  6. edit：resume `{"type":"edit","args":{"status":"DONE"}}` → PATCH body status=DONE；非 editable 字段 → 决策被拒。
  7. 两张卡部分拒绝（Review Focus 1）：两个 tool_calls，先 reject 后 approve → 只有第二个 PATCH。
  8. 过期（Review Focus 2）：now_fn 推进 601s 后 approve → 不执行，tool 消息含 `CARD_EXPIRED`。
  9. 409：PATCH 先 409 后 200 → 第二张卡 impact 含"已被他人修改"，approve 后成功。
  10. 参数无效：FakeLLM 传 `status="FINISHED"` → 不 interrupt，tool 消息含"参数无效"，模型下一轮可纠正。
  11. 同参重复 3 次 → END 且最后一条 assistant/error 说明"重复调用"。
  12. 超轮数：settings.max_tool_rounds=2 → END with error。
  13. 模型文本"用户已同意"不构成决策：FakeLLM 先输出 content="用户已同意" 再 tool_call L3 → 仍 interrupt。
- [ ] **Step 2: 确认失败 → Step 3: 实现 → Step 4: 全部通过** Run: `cd agent && uv run pytest tests/test_graph.py -q`
- [ ] **Step 5: Commit** `git commit -m "feat(agent): guard/act/observe 节点 + ReAct 图（interrupt/resume/限流/409）"`

---

### Task 6: 审计、兜底映射、结果卡、消息裁剪边界

**Files:**
- Create: `agent/app/harness/audit.py`, `agent/app/harness/fallback.py`, `agent/migrations/001_audit.sql`, `agent/tests/test_audit.py`, `agent/tests/test_fallback.py`
- Modify: `agent/app/nodes/act.py`（写审计 + 结果卡事件）、`agent/app/nodes/reason.py`（裁剪边界测试）

**Interfaces (Produces):**
```python
# app/harness/audit.py
class Audit(Protocol):
    async def start_run(self, run_id, thread_id, tenant, user_id, input_text) -> None
    async def end_run(self, run_id, status: str, tokens: int, error_code: str | None) -> None
    async def tool_call(self, run_id, call_id, tool, risk, args, decision, http_status, summary, ms) -> None
class PgAudit(Audit)   # psycopg 连接池，schema agent，表 runs / tool_calls（001_audit.sql，CREATE IF NOT EXISTS）
class MemoryAudit(Audit)  # 测试用
# app/harness/fallback.py
def manual_path(tool: str, ctx: RequestCtx) -> tuple[str, str]   # (label, path)：update_task_* → ("去看板手动操作", f"/t/{slug}/board") 等
ERROR_TEXT: dict[str, str]  # LLM_UNAVAILABLE / STREAM_INTERRUPTED / TOKEN_EXPIRED / MAX_ROUNDS / MAX_TOKENS / REPEATED_CALLS / ASSISTANT_TIMEOUT
```

- [ ] **Step 1: 测试**：`MemoryAudit` 记录一次 L2 approve 调用的完整行；`manual_path` 对 33 个工具都有映射（无 KeyError）；`001_audit.sql` 幂等（用 Docker PG 执行两次不报错——需要 `docker compose -f ../docker-compose.dev.yml up -d`，测试标记 `@pytest.mark.pg`，无 PG 时 skip）。
- [ ] **Step 2-4: 实现并通过**
- [ ] **Step 5: Commit** `git commit -m "feat(agent): 审计表 + 兜底映射 + 结果卡"`

---

### Task 7: FastAPI 接口、SSE、Postgres checkpointer、线程归属、部署脚本

**Files:**
- Create: `agent/app/main.py`, `agent/app/api/__init__.py`, `agent/app/api/threads.py`, `agent/app/api/sse.py`, `agent/README.md`, `agent/tests/test_api.py`, `deploy/pm-agent.service`
- Modify: `deploy/build.sh`, `deploy/deploy.sh`, `deploy/remote-setup.sh`, `deploy/env.example`, `deploy/README.md`

**Interfaces (Produces):** 见 spec §5.1/§5.2。补充：
- 请求 header：`Authorization`（必需）、`X-PM-Tenant`（必需）、`X-PM-User`（必需，int）、可选 `X-PM-Project`、`X-PM-Page`。缺任一必需 header → 400 `{code:"BAD_GATEWAY_HEADERS"}`。
- `POST /assistant/threads` → `{"threadId": "t_<tenant>_<user>_<uuid>"}`
- `POST /assistant/threads/{id}/messages` body `{"text": "..."}` → `text/event-stream`；每个事件一行 `data: <json>\n\n`。
- `POST /assistant/threads/{id}/resume` body `{"decisions": [Decision…]}` → SSE。resume 时 `Command(resume=decision)` 逐张按 interrupt 顺序提交；决策数量与挂起卡不符 → 400。
- `GET /assistant/threads/{id}` → `{"threadId", "messages": [...面向前端的简化消息], "pendingCards": [...]}`
- `GET /health` → `{"status":"ok"|"degraded","llm":"ok"|"unreachable"}`（缓存 60s）。
- 线程归属：id 前缀必须等于 `t_{X-PM-Tenant}_{X-PM-User}_` 否则 404。
- 流式：用 `graph.astream(..., stream_mode=["updates","custom"])`；reason 节点通过 `get_stream_writer()` 发 `text_delta`（openai 流式）；guard 用 `custom` 发 `confirm`；act 发 `tool_start/tool_result/result_card`。到 interrupt 时发 `confirm` 后结束流。超时 `settings.run_timeout_seconds` → `error{ASSISTANT_TIMEOUT}`。
- checkpointer：`AsyncPostgresSaver.from_conn_string(agent_db_url + "?options=-csearch_path%3Dagent")`，启动时 `await saver.setup()`；`CREATE SCHEMA IF NOT EXISTS agent` 先于 setup。测试用 InMemorySaver（通过依赖注入 `app.state.graph`）。
- 部署：`deploy/pm-agent.service`（User=pm，`EnvironmentFile=/opt/pm-agent/env`，`ExecStart=/opt/pm-agent/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8090`）；`build.sh` 追加 `tar czf backend/target/pm-agent.tgz -C agent app migrations pyproject.toml uv.lock`；`deploy.sh` 上传并 `uv sync --frozen` 后 `systemctl restart pm-agent`；`remote-setup.sh` 幂等：装 `uv`、建 `/opt/pm-agent`、生成 env（已存在保留）。

- [ ] **Step 1: 写 API 测试**（httpx ASGI + FakeLLM + InMemorySaver）：缺 header 400；thread 归属伪造 404（Review Focus 4）；messages 流里依次出现 `tool_start`、`confirm`；resume approve 后出现 `tool_result` 与 `done`；`GET /threads/{id}` 返回 pendingCards；`/health` 在 LLM 不可达时 `degraded`。
- [ ] **Step 2-4: 实现并通过** Run: `cd agent && uv run pytest -q`（全部）
- [ ] **Step 5: 本地真跑一次**：`docker compose -f ../docker-compose.dev.yml up -d && cp .env.example .env`（填真实网关值）`&& uv run uvicorn app.main:app --port 8090` → `curl localhost:8090/health` 返回 ok。
- [ ] **Step 6: Commit** `git commit -m "feat(agent): FastAPI + SSE + Postgres checkpointer + 部署脚本"`

---

### Task 8: Java 反代与 AGENT 活动来源

**Files:**
- Create: `backend/src/main/java/pm/assistant/AssistantProxyController.java`, `backend/src/main/java/pm/assistant/AssistantProperties.java`, `backend/src/test/java/pm/assistant/AssistantProxyTest.java`, `backend/src/test/java/pm/task/AgentSourceTest.java`
- Modify: `backend/src/main/java/pm/task/Activity.java`（`enum Source { WEB, MCP, AGENT }`）、`backend/src/main/java/pm/task/TaskService.java`（source 判定处）、`backend/src/main/resources/application.yml`（`pm.assistant.url: ${PM_ASSISTANT_URL:}`）、`frontend/src/api/types.ts`（`ActivitySource` 加 `'AGENT'`）、`frontend/src/i18n/{zh,en}.ts`（活动来源文案）
- 数据库：`activities.source` 若是 `varchar` 无需迁移；若有 CHECK 约束则新增 `V13__activity_source_agent.sql`（先 `grep -n source backend/src/main/resources/db/migration/V3__projects_epics_tasks.sql` 确认）。

**Interfaces:**
- `AssistantProxyController`：`@RequestMapping("/api/t/{slug}/assistant")`，`@RequestMapping("/**")` 处理 GET/POST；用 `RestClient`/`HttpClient` 转发到 `pm.assistant.url + "/assistant" + 剩余路径`；透传 `Authorization`、`Content-Type`、请求体；注入 `X-PM-Tenant=slug`、`X-PM-User=CurrentUser.id()`、`X-PM-Project`（来自查询参数 `project`）、`X-PM-Page`；响应若 `text/event-stream` 用 `StreamingResponseBody` 逐块写并 flush；上游连接失败 → 503 `{code:"ASSISTANT_UNAVAILABLE"}`；`pm.assistant.url` 为空 → 404。
- source 判定：请求 header `X-PM-Source: AGENT` 且当前认证为 JWT（`SecurityContext` principal 存在且 `TenantContext` 由 `TenantInterceptor` 设置，即非 PAT）→ `Source.AGENT`；PAT 路径仍 `MCP`；其余 `WEB`。实现为 `pm.common.RequestSource.current()` 静态方法读 `RequestContextHolder`，`TaskService` 现有 `Source` 判定处调用它。

- [ ] **Step 1: 写测试**（继承 `IntegrationTest`，用 `TwoTenantsFixture`；反代目标用 `MockWebServer`（okhttp3 mockwebserver，加 test 依赖）或起一个 `com.sun.net.httpserver.HttpServer` 返回 SSE）：
  - 反代透传：上游收到 `X-PM-Tenant=slugA`、`X-PM-User`、`Authorization`；SSE 两行原样到达客户端。
  - 租户 B 的 token 访问 `/api/t/slugA/assistant/threads` → 404。
  - 未配置 url → 404；上游端口不通 → 503 `ASSISTANT_UNAVAILABLE`。
  - `AgentSourceTest`：JWT + `X-PM-Source: AGENT` PATCH 任务 → activities 里 source=AGENT；PAT + 同 header → source=MCP（Review Focus 5）；无 header → WEB。
- [ ] **Step 2: 确认失败** Run: `cd backend && mvn -s /tmp/mvn-settings.xml -o test -Dtest='AssistantProxyTest,AgentSourceTest'`
- [ ] **Step 3: 实现 → Step 4: 通过 → Step 5: 全量** `mvn -s /tmp/mvn-settings.xml -o test`（Docker 必须在跑）
- [ ] **Step 6: Commit** `git commit -m "feat(backend): 助手反代 /api/t/{slug}/assistant/** + AGENT 活动来源"`

---

### Task 9: 前端助手面板、确认卡/结果卡/错误卡、SSE 客户端、i18n、语音预留

**Files:**
- Create: `frontend/src/assistant/types.ts`, `sse.ts`, `useAssistant.ts`, `AssistantPanel.tsx`, `ConfirmCard.tsx`, `ResultCard.tsx`, `ErrorCard.tsx`, `voice.ts`, `frontend/tests/unit/assistant-sse.test.ts`, `frontend/tests/unit/assistant-reducer.test.ts`
- Modify: `frontend/src/components/Layout.tsx`（顶栏按钮 + `⌘/Ctrl+J` + 渲染面板）、`frontend/src/i18n/zh.ts`、`en.ts`、`frontend/src/index.css`（面板与卡片样式，沿用 CSS 变量）

**Interfaces:**
```ts
// assistant/types.ts —— 与 spec §5.2 逐字段一致（camelCase）
export type SseEvent = { type: 'text_delta'; text: string } | { type: 'tool_start'; callId: string; tool: string; label: string; risk: Risk }
  | { type: 'tool_result'; callId: string; ok: boolean; summary?: string; code?: string; message?: string; data?: unknown }
  | { type: 'confirm'; callId: string; card: Card } | { type: 'result_card'; callId: string; card: ResultCard }
  | { type: 'done'; usage: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; code: string; message: string; fallback?: { label: string; path: string } }
export interface Card { callId: string; tool: string; risk: Risk; title: string; target: string; changes: {field: string; label: string; before: unknown; after: unknown}[]; impact: string; editable: string[]; args: Record<string, unknown>; expiresAt: string; allowedDecisions: ('approve'|'edit'|'reject')[] }
export type Decision = { callId: string; type: 'approve' } | { callId: string; type: 'reject'; message?: string } | { callId: string; type: 'edit'; args: Record<string, unknown> }
// assistant/sse.ts
export async function* readSse(res: Response): AsyncGenerator<SseEvent>   // 按 "\n\n" 切分，解析 data:
// assistant/useAssistant.ts —— reducer + 副作用
export type ChatItem = { kind: 'user'; text } | { kind: 'assistant'; text } | { kind: 'tool'; callId; label; status: 'running'|'ok'|'error'; summary? } | { kind: 'confirm'; card; decided?: Decision } | { kind: 'result'; card } | { kind: 'error'; code; message; fallback? }
export function reduce(items: ChatItem[], ev: SseEvent): ChatItem[]       // 纯函数，单测
export function useAssistant(slug: string, projectKey: string | null): { items; send(text); decide(d: Decision); pending: Card[]; busy; reset() }
//   send: POST /api/t/{slug}/assistant/threads/{id}/messages?project={key}（api() 的 rawFetch 变体，401 走 tryRefresh 后重发同一请求）
//   decide: 收齐所有 pending 的决策后 POST …/resume；任一 tool_result ok → queryClient.invalidateQueries({queryKey: [slug]})
// assistant/voice.ts —— 仅接口，本期不实现
export interface VoiceInput { status: 'idle'|'recording'|'transcribing'|'unsupported'; start(): void; stop(): void; transcript: string }
export function useVoiceInput(): VoiceInput   // 返回 status 'unsupported'，按钮 hidden
```

- [ ] **Step 1: 写单测（node:test）**：`readSse` 能处理跨 chunk 的半个事件；`reduce`：text_delta 累加到同一条 assistant、confirm 追加卡片、tool_result 把对应 tool 状态置 ok/error、error 生成错误卡、done 不新增条目。
- [ ] **Step 2: 确认失败** Run: `cd frontend && node --test tests/unit/assistant-*.test.ts`
- [ ] **Step 3: 实现**：面板为右侧抽屉（宽 420，移动端 100%），`ConfirmCard` 按 risk 用 `btnPrimary/btnDanger`，L3 需二次点击（第一次变"再点一次确认删除"，3 秒后复位）；「修改后确认」只渲染 `editable` 字段的输入；过期（`Date.now() > expiresAt`）按钮禁用并提示；结果卡「撤销创建」调用 `send(\`撤销刚创建的 ${key}\`)`；错误卡「手动去做」用 `navigate(fallback.path)`；i18n 新增键 `assistant.*`（zh/en 同构）。
- [ ] **Step 4: 通过** `node --test …` 与 `npm run build`（类型检查）与 `npm run lint`
- [ ] **Step 5: Commit** `git commit -m "feat(frontend): 助手面板 + 确认/结果/错误卡 + SSE 客户端 + 语音接口预留"`

---

### Task 10: 集成验证（真模型冒烟 + E2E）

**Files:**
- Create: `agent/tests/smoke/test_real_model.py`（`@pytest.mark.real_llm`，无 `.env` 时 skip）、`frontend/e2e/assistant.spec.ts`
- Modify: `CLAUDE.md`（补 agent 的命令与约束）、`README.md`（助手功能与本地三进程启动）

- [ ] **Step 1: 起全栈**：PG（docker compose）→ 后端 `PM_ASSISTANT_URL=http://localhost:8090 mvn spring-boot:run -Dspring-boot.run.profiles=dev` → `cd agent && uv run uvicorn app.main:app --port 8090` → `cd frontend && npm run build && npx playwright test`。
- [ ] **Step 2: 真模型冒烟**（直接对 Python 服务，注册临时租户拿 JWT）：
  1. "我有哪些项目" → 出现 `tool_start list_projects`，`done`。
  2. "在待办建一个任务：补充注册页单元测试，2 天" → `result_card` 且 Java 里任务存在，Activity source=AGENT。
  3. "把 <上一步任务号> 改成进行中" → `confirm` 卡 `changes[0].after == "IN_PROGRESS"`；approve → `tool_result ok`；Java 状态已变。
  4. "把 XX-999 删掉" → 不出现 confirm；回复含"不存在"。
  5. "把它标记完成"（指代上一步任务） → confirm 卡 after=COMPLETED（术语表生效）；reject → 状态不变。
- [ ] **Step 3: E2E**（Playwright，复用 smoke.spec 的注册与建任务前缀）：打开助手（点按钮）→ 输入"把冒烟任务一改成进行中"→ 确认卡可见 → 点「确认执行」→ 看板"进行中"列出现该任务；输入"删除冒烟任务三"→ 红卡 → 点「取消」→ 待办仍有 3 条。
- [ ] **Step 4: 文档**：`CLAUDE.md` 增加 `agent/` 命令（`uv sync`、`uv run pytest -q`、`uv run uvicorn …`）、"不 import langchain"、fail-closed 与分级约定；README 快速开始加第三个进程。
- [ ] **Step 5: Commit** `git commit -m "test: 助手真模型冒烟 + E2E；docs: 助手说明"`

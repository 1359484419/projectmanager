# pm-agent：跬步自然语言助手（FastAPI + 手写 LangGraph ReAct 图）

用户在面板里用自然语言完成项目操作；修改/删除/状态变更必须经确认卡，创建直接执行并回显可撤销。
本服务只做 **harness**（风险分级、审批、重试、限流、审计、兜底），权限与租户由 Java 反代校验后经 header 注入，
Python 以用户 JWT 回调现有 REST（`X-PM-Source: AGENT`）。

## ReAct 为什么不靠框架预制 agent

只用 `langgraph`（`StateGraph / interrupt / Command / checkpointer`），**不 import `langchain*`**（`tests/test_no_langchain.py` 断言）。
ReAct 由条件边强制：`reason` 之后只有两条出边——有 `tool_calls` → `prepare → guard → act → observe → reason`，
无 `tool_calls` → `END`。模型拿不到真实的 tool 消息就无法继续，口头"已完成 / 用户已同意"无效；
L2/L3 在 `guard` 节点 `interrupt()`，`act` 执行前再核对一次"该 callId 有 approve/edit 决策"（两道门共用同一判定）。

```
START → reason ─(tool_calls)→ prepare → guard(interrupt) → act → observe ─→ reason
              └─(无 tool_calls / 达上限)→ END              409 ↺ prepare（重出卡，最多一次）
```

## 本地开发

```bash
cd agent
cp .env.example .env            # 填真实网关；.env 已 gitignore
uv sync                         # Python 3.12
uv run pytest -q                # 全部单测（不需要真模型；pg 用例按 AGENT_DB_URL 探活，默认 localhost:5433，不可达时 skip）
uv run uvicorn app.main:app --port 8090 --reload
curl localhost:8090/health      # {"status":"ok","llm":"ok"}
```

Java 侧需要 `PM_ASSISTANT_URL=http://localhost:8090`（dev profile 下 `mvn spring-boot:run`），前端走 Java 反代。

## HTTP 接口（对 Java 反代暴露，前端不直连）

必需 header：`Authorization`、`X-PM-Tenant`（slug）、`X-PM-User`（int）；可选 `X-PM-Project`、`X-PM-Page`。缺少 → 400 `BAD_GATEWAY_HEADERS`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/assistant/threads` | → `{"threadId": "t_<tenant>_<user>_<uuid>"}` |
| POST | `/assistant/threads/{id}/messages` | body `{"text"}`（≤ `MAX_MESSAGE_CHARS`）→ SSE；有挂起确认卡时 409 `THREAD_PENDING`（附 `pendingCards`）；同一线程上一条 messages/resume 还在跑时 409 `THREAD_BUSY`（线程互斥，`harness/thread_lock.py`，单进程内存锁）；上一次运行被中断（超时/模型不可用/登录过期）时重发**同一句话**= 原地续跑，已完成的写操作不重放 |
| POST | `/assistant/threads/{id}/resume` | body `{"decisions":[{callId,type,args?,message?}]}` → SSE；决策按 callId 匹配本轮全部挂起卡，数量/callId 不符 400 `DECISION_MISMATCH`，无挂起卡 400 `NO_PENDING_CARDS` |
| GET | `/assistant/threads/{id}` | `{threadId, messages:[{role,text} / {role:"tool",callId,tool,ok}], pendingCards:[…]}` |
| GET | `/health` | `{"status":"ok"|"degraded","llm":"ok"|"unreachable"}`，缓存 60s |

线程归属：id 前缀必须等于 `t_{X-PM-Tenant}_{X-PM-User}_`，否则一律 404（不泄露存在性）。

SSE：每个事件一行 `data: <json>\n\n`，字段 camelCase（只在 `schemas.py` 的 `to_wire/from_wire` 转换）：
`text_delta`（逐 token）/ `tool_start` / `tool_result` / `confirm`（本轮全部卡一次发完后流结束，等 `/resume`）/ `result_card` / `done{usage}` / `error{code,message,fallback}`。
错误码：`LLM_UNAVAILABLE`、`STREAM_INTERRUPTED`、`TOKEN_EXPIRED`、`ASSISTANT_TIMEOUT`、`MAX_ROUNDS`、`MAX_TOKENS`、`REPEATED_CALLS`、`INVALID_PARAMS`、`CARD_EXPIRED`、`ASSISTANT_ERROR`；工具级 `UNKNOWN_OUTCOME`（写操作被中断后不重发，让用户核对）。

会话保留：最新 checkpoint 早于 `THREAD_RETENTION_DAYS`（默认 7）天的线程由 lifespan 每 `RETENTION_CHECK_SECONDS` 清理一次（`app/harness/retention.py`，含审计行）。

## 目录

```
app/main.py            FastAPI、生命周期（agent schema → AsyncPostgresSaver.setup → 审计表 → 图组装）
app/api/{deps,threads,sse,health}.py
app/graph.py  state.py  schemas.py  prompts.py  llm.py  settings.py（唯一配置源）
app/nodes/{reason,guard(prepare+guard),act(act+reauth),observe}.py
app/harness/{auth,tool_guard,approval,retry,limiter,audit,fallback,retention}.py
app/tools/…            工具目录（每个工具显式声明 L0-L3，未声明启动即失败）
migrations/001_audit.sql   agent.runs / agent.tool_calls（IF NOT EXISTS，幂等）
```

## 配置（`settings.py`，环境变量或 `agent/.env`）

`LLM_BASE_URL / LLM_API_KEY / LLM_MODEL(DeepSeek-V4.1-Flash) / LLM_STREAM / LLM_TRUST_ENV / PM_API_URL / AGENT_DB_URL / AGENT_DB_SCHEMA /
MAX_TOOL_ROUNDS=15 / MAX_TOKENS_PER_RUN=60000 / RUN_TIMEOUT_SECONDS=90 / CARD_TTL_SECONDS=600 / HEALTH_CACHE_SECONDS=60`。
所有上限只从这里读，模块内不写第二份常量。

## 部署

见 `deploy/README.md` 的「自然语言助手服务 pm-agent」：`deploy/build.sh` 打 `pm-agent.tgz`，`deploy/deploy.sh` 上传并 `uv sync --frozen`，systemd 单元 `deploy/pm-agent.service`。

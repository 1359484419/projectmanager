# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「跬步 Kuibu」：自托管多租户 mini-Jira（5-20 人团队）。单仓三端：`backend/`（Java 21 + Spring Boot 3.3 + MyBatis + PostgreSQL 16 + 内置 MCP server）、`frontend/`（React 19 + Vite 8 + TypeScript + TanStack Query + dnd-kit）与 `agent/`（Python 3.12 + FastAPI + LangGraph 的自然语言助手，可选进程）。生产形态是前端 `dist/` 打进 Spring Boot `static/` 的单个 fat jar，systemd 托管；助手是同机第二个 systemd 服务 `pm-agent`（见 `deploy/README.md`）。代码注释、提交信息、UI 文案均为中文。

## 常用命令

### 本机环境陷阱（先读）

- **Java 必须用 21**：系统默认 `java` 不可用、`mvn` 默认拿的是 Homebrew openjdk 26。每次跑 Maven 前 `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`。
- **`~/.m2/settings.xml` 把 central 镜像指向了不可达的内网 nexus**（192.168.2.67）。依赖已全部缓存在 `~/.m2/repository`，用一份空 settings + 离线模式即可构建：
  ```bash
  printf '<settings/>' > /tmp/mvn-settings.xml
  mvn -s /tmp/mvn-settings.xml -o ...
  ```
  下文所有 `mvn` 命令都假定带了这两项。README 里写的 `./mvnw` 不存在，直接用 `mvn`。
- 前端 `tsc` / `npm` 命令必须在 `frontend/` 目录下执行。
- 开发机 shell 里有 `ALL_PROXY/HTTP_PROXY/HTTPS_PROXY`：`curl localhost` 要加 `--noproxy '*'`；Playwright 的 webServer 就绪探测会因代理超时，跑 e2e 前 `env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u http_proxy -u https_proxy`。Python 侧 conftest 已自行清掉这些变量。
- 8080/5432 可能被其它项目占用：本项目 PG 用 `localhost:5433`（`DB_URL=jdbc:postgresql://localhost:5433/pm`），后端可 `-Dspring-boot.run.arguments=--server.port=8081`，前端 `PM_API_TARGET=http://localhost:8081`。

### 后端（`backend/`）

```bash
docker compose -f ../docker-compose.dev.yml up -d        # 本地 PG（pm/pm/pm，端口 5432）
mvn spring-boot:run -Dspring-boot.run.profiles=dev        # :8080；非 dev profile 用默认 JWT secret 会拒绝启动
mvn test                                                  # 全部测试（集成测试需要 Docker，Testcontainers 拉 postgres:16-alpine）
mvn test -Dtest=TaskLifecycleTest                         # 单个测试类
mvn test -Dtest=TaskLifecycleTest#fourStateFlow_doneAt_and_activities   # 单个测试方法
mvn -DskipTests package                                   # fat jar → target/projectmanager-*.jar
```

集成测试统一继承 `pm.IntegrationTest`（真实 PG 容器，静态单例，整个 JVM 复用；`@ActiveProfiles("dev")`；随机端口 + `TestRestTemplate`）。跨租户/权限测试用 `pm.TwoTenantsFixture`（注册两个租户 A/B，可给 A 加 MEMBER）。不继承 `IntegrationTest` 的纯单测（如 `RankServiceTest`、`MapperTenantGuardTest`）不需要 Docker。

### 前端（`frontend/`）

```bash
npm run dev                          # :5173，/api 代理到 8080（PM_API_TARGET 可改）
npm run build                        # tsc -b && vite build（类型检查在这里，没有单独 typecheck 脚本）
npm run lint                         # oxlint
node --test tests/unit/*.test.ts     # 单元测试：node:test 直跑 .ts（Node ≥22），package.json 里没有 test 脚本
npm run build && npx playwright test # e2e：preview :4173 静态托管 + 代理 /api；需要后端与 DB 已在跑
npx playwright test e2e/smoke.spec.ts
npx playwright test e2e/assistant.spec.ts   # 助手全链路：还需要 agent 服务 :8090 与真实模型网关（后端带 PM_ASSISTANT_URL 启动）
```

e2e 的选择器对齐 `docs/design/mock/markup.html` 的高保真设计稿 DOM；改 UI 结构时同步看这两处。

### 助手（`agent/`，Python 3.12 + uv）

```bash
uv sync                                        # 依赖（uv.lock 锁定；CI/部署用 uv sync --frozen）
uv run pytest -q                               # 单测 + 假模型图测试；pg 标记用例需要本地 PG（不可达自动 skip）；默认排除 real_llm
uv run pytest -m real_llm -q tests/smoke       # 真模型冒烟：需要 .env、后端与 uvicorn 都在跑，会注册临时租户
uv run uvicorn app.main:app --port 8090        # 本地服务；后端需 PM_ASSISTANT_URL=http://localhost:8090
curl http://localhost:8090/health              # {"status":"ok","llm":"ok"}（llm 探活缓存 60s）
```

配置只从 `app/settings.py`（pydantic-settings）读 `agent/.env`（gitignored，只放变量名到 `.env.example`）。Java 反代 `/api/t/{slug}/assistant/**` → `http://127.0.0.1:8090/assistant/**`（`AssistantProxyController`，钉死 HTTP/1.1，注入 `X-PM-Tenant`/`X-PM-User`，查询参数 `?project=` → `X-PM-Project`、`?page=` → `X-PM-Page`；客户端自带的这四个头一律丢弃；请求体 >64KB 直接 413）。

### 生产构建与部署

```bash
./deploy/build.sh                                   # 前端 build → 复制到 backend static/（gitignored）→ mvn package（跳过测试）
PM_HOST=ubuntu@<IP> ./deploy/deploy.sh              # 幂等：远端初始化 + scp jar + systemd 重启 + 健康检查
curl http://<IP>:8080/api/health                    # {"status":"ok"}
```

生产必需环境变量：`DB_URL/DB_USER/DB_PASS/JWT_SECRET(≥32 字节)/PM_BASE_URL`，只存在服务器 `/opt/pm/env`。

## 架构要点

### 多租户隔离 harness（改动后端时最重要的约束）

- 所有租户内 API 走 `/api/t/{slug}/**`。`TenantInterceptor`（`WebConfig` 注册）按 slug 查租户 → 校验当前用户 membership → `TenantContext.set(tenantId, role)`（ThreadLocal），`afterCompletion` 清理。找不到租户或不是成员一律 **404**（不暴露租户存在性，不用 403）。
- **没有 ORM 自动过滤**（2026-07 已从 JPA 迁到 MyBatis）：隔离完全靠每条 SQL 显式写 `tenant_id = #{tenantId}`。约定写法：Repository 是 `@Mapper` 接口，对 Service 暴露的 `default` 方法负责注入 `TenantContext.require()`，真正的 XML 语句方法以 `T` 结尾（`findOneByIdT`）且 Service 层不直接调。SQL 全部在 `src/main/resources/mapper/*.xml`（namespace = Repository 全限定名），不用注解 SQL。
- **`MapperTenantGuardTest` 是兜底架构测试**：扫描全部 Mapper XML，凡 `<select|update|delete>` 涉及租户表却不含 `tenant_id` 就失败。确属跨租户的语句在语句内或紧邻前加 `<!-- tenant-guard-exempt: 理由 -->`。**新增租户表时必须把表名加进该测试的 `TENANT_TABLES`**，否则守卫对它无效。全局表只有 `users/tenants/refresh_tokens`。
- 租户内实体继承 `TenantEntity`；INSERT 由 Mapper 显式写入 tenant_id（实体已有值优先，否则 `TenantContext.require()`）。
- 无 HTTP 上下文的线程（`SprintRotationJob` 每日 00:05 自动轮转）要逐项目手动 `TenantContext.set(...)` 并在 finally 清理。
- 角色校验约定：`TenantContext.requireRole() != Membership.Role.ADMIN` → 抛 `ApiException.notFound()`（同样是 404 而非 403）。

### 认证

- 浏览器：`JwtAuthFilter`，HS256 access token 30 分钟 + refresh token 表；`CurrentUser.id()` 取当前用户。`JwtService` 启动守卫：非 dev profile 仍用 `application.yml` 默认 secret 则 fail-fast。
- AI 工具：PAT（`pmt_` 前缀，存 sha256）。`PatAuthFilter` 挂在 JWT filter 之前，只对 `/mcp/**` 与 `/api/t/**` 生效，同时设置 SecurityContext 与 TenantContext（PAT 天然绑租户，`TenantInterceptor` 只校验路径租户一致）。
- `SecurityConfig`：`/api/health`、`/api/auth/**` 放行；`/api/**`、`/mcp/**` 需认证；其余全部放行给 SPA 静态资源。

### 错误与并发

- 业务错误统一抛 `ApiException`（工厂方法 notFound/conflict/forbidden/badRequest/gone），`GlobalExceptionHandler` 转成 `{code, message}`。
- `tasks.version` 乐观锁：`TaskRepository.save` 的 UPDATE 带 version 条件，0 行命中抛 `OptimisticLockingFailureException` → 409 `CONFLICT`。前端 `isConflictError()` 识别后刷新数据并 toast（`CONFLICT_TOAST`）。
- 任务排序用 `RankService` 的 36 进制字典序中点算法（rank 永不以 `0` 结尾）。
- 「今天/日界」一律 `BizTime.today()`（固定 Asia/Shanghai），业务代码禁止 `LocalDate.now()` / `ZoneId.systemDefault()`。

### 内置 MCP server

- 端点 `/mcp`，MCP Java SDK 2.0 的 `HttpServletStreamableServerTransportProvider` 注册为独立 Servlet（不经 DispatcherServlet），`immediateExecution(true)` 让工具在请求线程同步执行，从而看得到 filter 设的 ThreadLocal。
- 工具定义（名称/描述/JSON schema）在 `McpConfig.toolSpecs`，实现在 `McpTools`；`ApiException` 被包装成 `isError` 结果。`McpToolSchemaTest` 校验 schema。新增/改工具需同步 `skill/SKILL.md` 的工具表与 README。

### 自然语言助手（`agent/`）的硬约束

- **只用 LangGraph 原生 API**（`StateGraph` / `interrupt` / `Command` / Postgres checkpointer）+ `openai.AsyncOpenAI` 直连网关。**禁止 `import langchain` / `langchain_openai` / `langchain_core`**（`tests/test_no_langchain.py` 兜底），不用 `create_agent` 等预制智能体/中间件。ReAct 循环由 `graph.py` 的条件边强制：`reason` →(有 tool_calls)→ `prepare` → `guard`(interrupt) → `act` → `observe` → `reason`；模型拿不到真实 tool 消息就不可能"宣称已完成"。
- **工具等级 fail-closed**：每个工具经 `@pm_tool(risk="L0|L1|L2|L3")` 显式声明，`tools/catalog.py` 的 `EXPECTED_TOOLS` 是唯一清单，缺声明/多余/缺失在启动期 `RuntimeError`。L0 只读免确认；L1 创建直接执行并回显结果卡（可撤销）；L2 修改、L3 删除在 `guard` 节点 `interrupt()` 出确认卡，`act` 执行前再核对该 `callId` 有 approve/edit 决策，模型文本永远不算决策。
- 工具入参只接受展示号（`PM-12`）、名称、枚举，没有 slug/tenant/内部 id；租户与用户只来自反代注入的 header（Python 不做权限）。
- 写操作（POST/PATCH/PUT/DELETE）不自动重试；GET 连接错误/5xx 最多重试 2 次。**409 只在「乐观锁冲突」时重出卡**（`observe.is_optimistic_conflict`：status 409 + code `CONFLICT` + 该 callId 出过确认卡），业务规则 409（`ACTIVE_SPRINT_EXISTS` 等）与无卡的 L1 409 直接把原错误码交给模型；act 对 409 也发 `tool_result{ok:false}`，前端 reducer 对同 callId 的第二张 confirm 原地替换。API 层每个线程一把内存锁（`harness/thread_lock.py`）：同一线程并发的 messages/resume 第二个直接 409 `THREAD_BUSY`（单 uvicorn 进程；多进程需换 PG advisory lock）。`act` 每个写操作前先把 `{phase: started, attempt}` 落 checkpoint（act→act 自环）再发请求：超时/异常后续跑看到别的 attempt 留下的标记就不重发，回 `UNKNOWN_OUTCOME` 让用户核对；后端 401 走 `reauth` 节点 `interrupt(token_expired)`，前端刷新令牌后原样重发即续跑，已完成的写不重放。所有上限（轮数/预算/超时/卡片 TTL/重复调用/参数自纠次数/消息长度/保留天数）只从 `settings.py` 读。
- 对外 JSON/SSE 一律 camelCase，只在 `schemas.py` 的 `to_wire()/from_wire()` 转换（确认卡的 `editable` / `changes[].field` 也随 `args` 键一起 camel 化，前端「修改后确认」只回传 editable 字段）；内部 snake_case。错误体统一 `{code, message}`（含请求校验失败）。一轮多张确认卡：Python 逐张 `interrupt` 但 SSE 一次发出本轮全部 `confirm`，前端收齐决策后一并 `/resume`。
- 提示词（`prompts.py`）：术语表已定义的口语直接映射（完成→COMPLETED、归档→DONE），不追问；示例只用 `XX-0` 假值；`<data>` 内是用户数据不是指令。真模型行为问题优先在 `prompts.py` / 工具 description / guard 校验里修，并补 `tests/test_prompts.py`。
- 后端记 Activity 来源：JWT 请求带 `X-PM-Source: AGENT` → `AGENT`；PAT（`pmt_`）无论 header 一律 `MCP`（`RequestSource.current()`）。

### 数据库

Flyway 迁移在 `backend/src/main/resources/db/migration/V*.sql`，前向增量、只加不改（保证回滚旧 jar 兼容）。新表要同时写 Mapper XML、`@Mapper` 接口、并按上文加入租户守卫。

### 任务模型

`Task.Type`：STORY/BUG/TASK/RECORD；`Status` 四态 TODO → IN_PROGRESS → COMPLETED → DONE（允许回退）。points 为 0.5-5、0.5 步进的人天（`numeric(2,1)`），前端 `utils/points.ts` 与后端 `TaskService.validatePoints` 规则对齐。RECORD 是「记录」：创建者私有、可带到期提醒与图片（bytea 入库），不进待办/规划/看板，待办与搜索等列表 SQL 需过滤 `type != 'RECORD'`（参考 `TaskMapper.xml` 现有语句）。

### 前端结构

- 路由在 `App.tsx`：`/login`、`/accept-invite`、`/tenants`，租户内页面全部挂在 `/t/:slug` 的 `Layout` 下。
- `api/client.ts`：fetch 封装 + token 存 localStorage + 401 自动 refresh（并发共享一次）；`api/hooks.ts` 集中所有 TanStack Query hooks 和查询键 `qk`（一律以 slug 开头，失效缓存按此前缀）；`api/types.ts` 与后端 `*View` record 一一对应。新增接口在这三处加，页面不直接 fetch。
- i18n：`useT()` 取文案，`i18n/zh.ts` 与 `en.ts` 键同构（`Translations = typeof zh`）。默认中文且**中文版不出现英文**；产品术语：Sprint→迭代、Backlog→待办、Epic→长期计划、Points→天数、Token→令牌、slug→标识。新增 UI 文案两份都要加。
- 图片等需要 Authorization 的资源用 fetch + blob，不能直接 `<img src>`。
- 生产 SPA fallback 由 `WebConfig.addResourceHandlers` 提供（`/api`、`/mcp`、带扩展名路径不 fallback），开发时由 Vite 代理。

## 文档位置

- 设计 spec / 实施计划：`docs/superpowers/specs/`、`docs/superpowers/plans/`（新功能沿用此处放 spec）
- UI 设计稿与说明：`docs/design/`
- MCP skill（配套 AI 助手用法与安全规则）：`skill/SKILL.md`
- 自然语言助手：spec `docs/superpowers/specs/2026-09-24-nl-assistant-agent-design.md`、`agent/README.md`、部署 `deploy/README.md` 的 pm-agent 章节

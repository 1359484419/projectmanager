# 2026-07-08 Overnight QA 报告

夜间 QA 轮次：审计 → 修复 → 全量回归 → 部署 → 线上复验。本文为最终集成报告。

## 验收用账号

线上环境：http://124.222.85.240:8080 （租户 slug：`test-team`）

| 账号 | 密码 | 角色 | 说明 |
|---|---|---|---|
| admin@test.local | Test1234! | ADMIN | test 租户管理员，验收主账号 |
| qa-invite-1@test.local | Test1234! | MEMBER | 本轮复验邀请流程时创建的成员 |

- 以上为测试账号，密码仅用于验收，可入库。
- **PAT（个人访问令牌）**：明文不入库。如需 MCP 验收，请用上述账号登录后到「个人设置 → API Tokens」自行生成（`pmt_` 前缀，生成时仅展示一次）。
- 复验产生的数据：项目 `QAB`（复验项目B）、任务 `TEST-8`（复验-跨项目引用任务）、Sprint「复验SprintB」，可留作验收样例或随手删除。

## 一、回归与部署结果

| 项 | 结果 |
|---|---|
| 后端 `mvn test` | 90 个测试全部通过（0 失败 0 错误 0 跳过） |
| 前端 `npm run build` | 通过（tsc + vite，bundle 437 KB / gzip 129 KB） |
| e2e `npx playwright test`（本地栈 8081 + preview 4173） | 1/1 通过（注册→建项目→Backlog→Sprint→看板 DONE→Dashboard→燃尽图全链路，含估点 0.5-5 校验） |
| 部署 | `deploy/build.sh` + `deploy/deploy.sh` → 124.222.85.240，旧 jar 已自动备份至 `/opt/pm/backups/` |
| 线上健康 | `/api/health` → `{"status":"ok"}`；SPA 根路径 200 |
| 线上 DB 迁移 | Flyway V7（tasks.version）、V8（invites.used_at/used_by）均 success |

集成过程未发现新问题，无需额外修复提交。

## 二、本轮 findings 全清单

> 清单依据本轮修复提交与审计上下文重建（审计原始产出未落盘）。severity 为集成侧评定。

| # | 级别 | 领域 | 问题 | 状态 |
|---|---|---|---|---|
| F1 | P0 | 后端/安全 | 邀请 token 可重复使用：被移出的成员拿旧邀请链接可自助重新加入租户 | 已修（6645c4d） |
| F2 | P0 | 后端/数据隔离 | 任务写入 sprintId/epicId/assigneeId 不校验归属，可造成跨项目/跨租户引用污染 | 已修（ca32158） |
| F3 | P1 | 后端/并发 | 任务无乐观锁，并发编辑同一任务时后提交者用旧快照覆盖，静默丢更新且审计与数据矛盾 | 已修（0e0ef74） |
| F4 | P1 | 前端/会话 | refresh token 失效后请求持续 401，用户卡死在报错页面，不跳登录 | 已修（2f2aeb5） |
| F5 | P1 | 前端/会话 | 登出/换账号登录不清 react-query 缓存，账号间数据串号 | 已修（f15b132） |
| F6 | P1 | 前端/导航 | 顶栏项目切换器不真正切换项目，各页面各自为政不联动 | 已修（b1e9afd） |
| F7 | P1 | 后端+前端 | PATCH 无法置空字段（移回 Backlog / 取消指派语义缺失） | 已修（b5ed40c，上一批） |
| F8 | P2 | 前端/可发现性 | Planning「移回 Backlog」为图标按钮不可发现 | 已修（8b543ca，上一批） |
| F9 | P2 | 前端/交互 | 乐观锁 409（CONFLICT）前端无专门冲突提示 UI，仅走通用报错 toast，用户不知道该「重取后重试」 | **未修** |
| F10 | P2 | 运维/安全 | 无域名无 HTTPS，Bearer token 明文 HTTP 传输（内网/小团队暂可接受） | **未修** |
| F11 | P2 | 前端/性能 | 主 bundle 437 KB 单文件未 code-split（gzip 129 KB，尚可接受） | **未修** |
| F12 | P2 | 测试 | e2e 仅 1 条冒烟链路，邀请/多租户隔离/并发冲突均靠后端集成测试覆盖，无 UI 层回归 | **未修** |

## 三、修复对照表（finding → commit → 线上复验）

复验方式：curl 直连线上 API（test-team 租户），DB 断言经 SSH psql。

| finding | commit | 线上复验 | 结果 |
|---|---|---|---|
| F1 邀请一次性 | 6645c4d | 创建邀请 → 第 1 次 accept 新用户 HTTP 200；同 token 第 2 次 accept HTTP 410 `INVITE_USED` | ✅ 通过 |
| F2 跨项目引用 | ca32158 | 任务挂他项目 sprint → 400 `INVALID_SPRINT`；不存在 epic → 400 `INVALID_EPIC`；非本租户 assignee → 400 `INVALID_ASSIGNEE`；挂本项目 sprint → 200 | ✅ 通过（3 负 1 正） |
| F3 乐观锁 | 0e0ef74 | 线上 DB：Flyway V7 success、`tasks.version` 列存在；并发 409 语义由集成测试 TaskConcurrencyTest 覆盖（curl 无法复现真实并发窗口，属结构性验证） | ✅ 通过（schema + 测试） |
| F4 会话失效跳转 | 2f2aeb5 | 线上 bundle 含 `login?returnTo=` 跳转逻辑指纹（前端行为，curl 仅能做代码指纹验证） | ✅ 代码已上线 |
| F5 缓存串号 | f15b132 | 线上 bundle 含 queryClient `clear()` 调用指纹 | ✅ 代码已上线 |
| F6 项目切换器 | b1e9afd | 线上 bundle 含 `pm-project:` 持久化 key 指纹 | ✅ 代码已上线 |
| F7 PATCH 置空 | b5ed40c | PATCH `{"sprintId":null}` → 200 且 sprintId=null（移回 Backlog）；全局搜索 `/tasks/search?q=复验` → 200 命中 1 条 | ✅ 通过 |
| F8 移回 Backlog 按钮 | 8b543ca | 前端 UI 项，线上 bundle 含「移回 Backlog」文字按钮指纹 | ✅ 代码已上线 |

> F4/F5/F6/F8 为纯前端行为，curl 复验只能确认修复代码已部署（bundle 指纹）；交互层已由本地 Playwright 冒烟间接覆盖，建议验收时人工点一遍（切项目 → 全站联动；登出换号 → 数据不串）。

## 四、第二轮修复（P2 清理，凌晨完成并已上线）

全量回归 **105/105** 后端测试、前端 build + 26 单测、Playwright e2e **2/2**（含新增多用户链路）全绿后部署，线上逐项复验通过。

| 修复项 | commit | 线上复验 |
|---|---|---|
| 容量 override 守卫：仅 ADMIN 或本人；目标须本租户成员 | 4061471 | MEMBER 改他人 404 / 改自己 200 ✅ |
| MCP `list_my_tasks` sprint 参数可选、默认 current | 137db07 | 不带 sprint 调用成功返回 ✅ |
| 文本长度上限（title≤200 等 7 项，中文报错） | 13992cb | 201 字 title → 400 VALIDATION ✅ |
| 业务时区统一 Asia/Shanghai（燃尽/轮转/日界） | e085198 | 服务器本就 CST，属防漂移加固 ✅ |
| JWT secret 启动守卫（非 dev 用默认值拒绝启动） | e9e1aa2 | 线上 env 已确认为 64 位强随机 ✅ |
| 项目创建改为仅 ADMIN（与项目设置一致）⚠️ 行为变更 | 9389d6c | MEMBER 建项目 404 ✅ |
| 409 冲突统一提示 + 抽屉自动回填最新值（F9） | 85c4eb5 | 单测覆盖（并发窗口无法 curl 复现） |
| code-split：主 chunk 437KB → 128KB（F11） | 04b4a39 | 线上已生效 |
| **现货 bug**：移出成员成功却报「移出失败」（api() 不兼容 200 空响应体） | 07bc293 | e2e 覆盖 ✅ |
| 多用户 e2e 链路（F12 部分） | 6debcc3 | 本地 2/2 通过 |

> ⚠️ 行为变更需确认：**项目创建现在仅 ADMIN 可用**（按与项目设置一致的原则修复）。如果你希望普通成员也能建项目，说一声即可回退。

## 五、最终遗留

1. **HTTPS/域名**（F10）：PAT 与密码目前走明文 HTTP，建议尽快绑域名上证书（deploy/README.md 有方案）——需要你提供域名，无法代决。
2. e2e 未覆盖「旧邀请链接失效」「双租户隔离」UI 链路（API 层已有集成测试覆盖）。
3. 本地裸起后端现在必须 `SPRING_PROFILES_ACTIVE=dev` 或设 `JWT_SECRET`（JWT 守卫的副作用，application.yml 有注释）。

## 六、提交清单（第一轮）

```
b5ed40c fix: PATCH 置空语义（移回 Backlog/取消指派）+ 卡片描述摘要 + 全局关键词搜索   （上一批已推送）
8b543ca fix(planning): 移回 Backlog 改为明确的文字按钮                                （上一批已推送）
b1e9afd fix(frontend): 顶栏项目切换器真正切换项目并全站联动
2f2aeb5 fix(frontend): refresh 失败时全局清 token 并跳转 /login（带 returnTo 回跳）
f15b132 fix(frontend): 登出/换账号登录时清空 react-query 缓存，杜绝账号间数据串号
0e0ef74 fix(task): 任务加 @Version 乐观锁，并发编辑丢更新改为 409 冲突
6645c4d fix(invite): 邀请 token 一次性消费，堵住被踢成员拿旧链接自助重新加入
ca32158 fix(task): sprintId/epicId/assigneeId 写入前校验归属，杜绝跨项目/跨租户引用污染
```

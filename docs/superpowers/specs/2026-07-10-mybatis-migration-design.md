# 持久层迁移：Spring Data JPA → MyBatis

日期：2026-07-10
状态：已批准（用户拍板：SQL 全 XML、接口签名不动、安全性由设计保证）

## 目标

后端持久层从 Spring Data JPA (Hibernate) 全量迁移到 MyBatis，SQL 全部写在 XML Mapper 中。
用户更熟悉 MyBatis，便于后续维护与调试。

## 不变量（迁移约束）

1. **Repository 接口方法签名不动** —— Service/Controller 层零改动。
   `extends JpaRepository` 改为 `@Mapper` 接口，用到的继承方法（save/findOneById/delete 等）显式声明，签名一致。
2. **数据库 schema 零变化** —— Flyway 迁移（V1-V9）不动，可随时回滚旧 jar。
3. **REST/MCP API 行为不变** —— 108 个既有测试全部通过为验收线。
4. **实体类去 JPA 注解变纯 POJO**，字段与类型不动，MyBatis resultMap 映射。

## 安全设计（替代 Hibernate 自动机制）

### 多租户隔离（替代 @Filter tenantFilter）

- 每条涉及租户表的 SQL **显式**写 `tenant_id = #{tenantId}`，参数由 DAO 层从 `TenantContext.require()` 注入。
- **架构测试兜底**：新增 `MapperTenantGuardTest`，扫描 classpath 全部 Mapper XML：
  凡 FROM/JOIN/UPDATE/DELETE 租户表（projects/epics/tasks/activities/comments/sprints/capacity_overrides/invites/api_tokens/memberships）
  的语句必须包含 `tenant_id`，否则测试失败。白名单机制允许显式豁免（如按 PK 且上层已校验的语句，需注释理由）。
- `TenantInterceptor` 保留路径校验与 `TenantContext` 注入，删除 Hibernate Session filter 逻辑。
- `McpTools` 中手动 enableFilter 的代码删除，依赖显式 SQL。

### 乐观锁（替代 @Version）

- `tasks.version` 列保留。Task 的 UPDATE 语句带 `WHERE id = #{id} AND version = #{version}`，
  并 `SET version = version + 1`。
- Mapper 返回影响行数，DAO 层 0 行时抛 `ApiException.conflict("CONFLICT", ...)` —— 与现有 409 行为一致。

## 技术选型

- `mybatis-spring-boot-starter` 3.x（配 Spring Boot 3.3）
- SQL 全部在 `src/main/resources/mapper/*.xml`，不用注解 SQL
- 驼峰映射：`map-underscore-to-camel-case: true`
- 事务：沿用 Spring `@Transactional`（MyBatis-Spring 原生支持）

## 迁移范围（13 个 Repository → Mapper）

| 域 | Repository | 特殊点 |
|----|-----------|--------|
| user/auth | UserRepository, RefreshTokenRepository | 非租户表（users, refresh_tokens 全局） |
| mcp | ApiTokenRepository | 租户绑定 |
| tenantadmin | TenantRepository, MembershipRepository, InviteRepository | tenants 全局，memberships/invites 租户 |
| project/epic | ProjectRepository, EpicRepository | 租户表 |
| task/comment | TaskRepository, ActivityRepository, CommentRepository | **乐观锁**、搜索 LIKE、maxSeq/maxRank |
| sprint | SprintRepository, CapacityOverrideRepository | 租户表 |

JPA 行为等价注意：
- `saveAll`/`save` 需区分 INSERT/UPDATE（按 id 是否为 null）
- `findByKeyForUpdate`（悲观锁）→ `SELECT ... FOR UPDATE`
- 生成主键回填：`useGeneratedKeys="true" keyProperty="id"`
- `deleteByTaskId` 等派生方法逐条翻译为显式 SQL

## 执行方式

Workflow 并行：
1. **Phase 1（串行）**：基建 —— pom 依赖、MyBatis 配置、TenantEntity/TenantInterceptor 改造、
   User 域示范迁移作为模板
2. **Phase 2（并行 4 agents）**：按域迁移，各 agent 只动本域文件，不碰共享文件
3. **Phase 3（串行）**：全局编译修复 + 108 测试跑通 + 新增租户隔离架构测试
4. **Phase 4**：本地全流程冒烟（起 PG + 应用 + curl 全链路）→ 通过后部署上线

## 回滚

部署前旧 jar 自动备份到 /opt/pm/backups；schema 无变化，直接回滚 jar 即可。

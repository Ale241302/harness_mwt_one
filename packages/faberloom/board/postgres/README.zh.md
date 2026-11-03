# Mesa 中央 — PostgreSQL 架构与 RLS（方案 A）

[English](README.md) | 中文

Mesa 中央存储的引导脚本：单一 PostgreSQL 架构，每行都带 `tenant_id`，并由行级安全（RLS）强制隔离。本 `schema.sql` 是系统**唯一的 DDL**：网关（`gateway/board-api.mjs`）读取并应用它，不再保留内嵌架构。状态机仍在 `packages/faberloom/board/src`，不从这里改动。

它位于 `packages/faberloom/board/postgres/`——比 `packages/` 深三层——以避开 `packages/*/*`、pnpm 工作区与覆盖率门（`packages/*/*/src/**`）。它是设计与验证产物，不是可发布包。

## 概述

一个 PostgreSQL 架构存储中央 Mesa：每行携带 `tenant_id`，由行级安全强制隔离。网关应用 `schema.sql`；状态机仍在 `packages/faberloom/board/src`。

## 目录

- [Modelo](#modelo)
- [RLS](#rls)

<a id="modelo"></a>
## 模型

方案 A：一个共享的中央 Mesa，以租户为隔离边界。没有按客户划分的数据库，也没有按租户的 `search_path`。

```
mesa_items  ──1:N──  mesa_events
   │ tenant_id          │ tenant_id + item_id
   └ PK (tenant_id,id)  └ PK (tenant_id,item_id,seq)
```

- `tenant_id` 是 board 的 `companyId` 投影为 UUID。永不为空，且属于所有主键。若 `companyId` 已是 UUID 则原样使用；否则网关将其投影为确定性的 UUIDv5（`mesaTenantUuid()`），并把原始键保存在 `tenant_key`。
- `owner_id` 是认证主体（`BoardActor.id`）；租户不由它推导。
- `space_id` 是对 Spaces 的不透明引用。网关像租户一样将其投影为 UUID（`mesaSpaceUuid()`），并把原始值保存在 `space_key`。这里不校验 Space 归属；那仍属于 Spaces 服务的职责。
- `business_key` 是服务端推导的身份。其唯一性按租户，且只作用于**非终态**行之间。
- `row_version` 是乐观并发令牌。由应用写入；数据库不会自增。
- `payload` 保存 board 文档，必须是 JSON 对象。

### `mesa_items`

| 列 | 类型 | 约束 |
|---|---|---|
| `tenant_id` | `uuid` | `NOT NULL`，主键的一部分 |
| `id` | `uuid` | `NOT NULL DEFAULT gen_random_uuid()` |
| `owner_id` | `text` | `NOT NULL`，非空 |
| `tenant_key` | `text` | 可空；原始 `companyId`（当它不是 UUID 时） |
| `space_id` | `uuid` | 可空 |
| `space_key` | `text` | 可空；原始 `spaceId`（当它不是 UUID 时） |
| `business_key` | `text` | `NOT NULL`，非空 |
| `state` | `text` | `NOT NULL`，非空 |
| `row_version` | `bigint` | `NOT NULL DEFAULT 1`，`>= 1` |
| `title` | `text` | 可空；API 的 POST 中必填 |
| `evidence` | `jsonb` | `NOT NULL DEFAULT '[]'`，JSON 数组 |
| `payload` | `jsonb` | `NOT NULL`，JSON 对象 |
| `run_id` | `text` | 可空；产生该事项的 run |
| `idempotency_key` | `text` | 可空；按租户唯一 |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`，`UPDATE` 时由触发器维护 |

主键：`(tenant_id, id)`。

API 的六个列（`title`、`evidence`、`run_id`、`idempotency_key`、`tenant_key`、`space_key`）通过 `ADD COLUMN IF NOT EXISTS` 与幂等检查添加；其类型只在这里声明一次。`evidence` 必须是数组，键存在时不得为空。

部分唯一索引：

```sql
CREATE UNIQUE INDEX mesa_items_live_business_key_uniq
  ON public.mesa_items (tenant_id, business_key)
  WHERE state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO');
```

四个终态复刻 board 的 `TERMINAL_STATES`。若 board 增加其他终态，需要在迁移中更新谓词；这里使用字面量（而不是函数），因为索引谓词必须不可变。

幂等性的部分唯一索引：

```sql
CREATE UNIQUE INDEX mesa_items_tenant_idempotency_key_uniq
  ON public.mesa_items (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

查询索引：

- `(tenant_id, state, created_at)`
- `(tenant_id, space_id)`
- `(tenant_id, owner_id)`
- `(tenant_id, lower(owner_id))` — `client_b2b` 的列表按小写比较，以容忍迁移行。

### `mesa_events`

| 列 | 类型 | 约束 |
|---|---|---|
| `tenant_id` | `uuid` | `NOT NULL` |
| `item_id` | `uuid` | `NOT NULL` |
| `seq` | `bigint` | `NOT NULL`，`>= 1` |
| `actor` | `text` | `NOT NULL`，非空 |
| `command` | `text` | `NOT NULL`，非空 |
| `from_state` | `text` | 可空；存在时非空 |
| `to_state` | `text` | `NOT NULL`，非空 |
| `payload` | `jsonb` | `NOT NULL DEFAULT '{}'`，JSON 对象 |
| `at` | `timestamptz` | `NOT NULL DEFAULT now()` |

主键：`(tenant_id, item_id, seq)`。复合外键
`(tenant_id, item_id) → mesa_items(tenant_id, id) ON DELETE RESTRICT`。

复合外键阻止一个租户的事件指向另一个租户的事项。`RESTRICT` 是刻意的：有审计历史的事项必须先删除事件才能删除，而事件不可删除。该表只追加。

## RLS

两张表都启用 `ENABLE ROW LEVEL SECURITY` 与 `FORCE ROW LEVEL SECURITY`。`FORCE` 也作用于表属主；只有超级用户或带 `BYPASSRLS` 的角色可以绕过。因此表属主若不进入 `mesa_app` 或没有明确的运维角色，也看不到行：支持查询必须设置上下文或显式使用管理连接。

### 会话变量

`withTenant()` 用 `set_config(..., true)`（事务级，等价于 `SET LOCAL`）设置这些变量：

| 变量 | 类型 | 用途 |
|---|---|---|
| `app.tenant_id` | `uuid` | 隔离边界；必填 |
| `app.actor_id` | `text` | 认证主体；`owner_id` 授权 |
| `app.role` | `text` | `client_b2b` 或控制台角色 |

若 `app.tenant_id` 缺失或为空，`mesa_current_tenant_id()` 返回 `NULL`；没有行匹配，写入的 `WITH CHECK` 被拒绝。系统默认关闭。

`withTenant()` **总是**重写 `app.actor_id` 与 `app.role`，即使调用者没有传入（则置空）。这样会话级的 `SET app.role = 'admin'` 不会泄漏到未请求它的行务。

### 应用角色

`mesa_app` 以 `NOLOGIN`、`NOSUPERUSER`、`NOBYPASSRLS` 创建，无 `CREATEDB` 与 `CREATEROLE`。它不是表属主。运行时登录单独创建，不继承权限，并通过 `SET LOCAL ROLE mesa_app` 进入该角色：

```sql
CREATE ROLE mesa_login LOGIN NOINHERIT NOBYPASSRLS;
GRANT mesa_app TO mesa_login;
```

### 策略矩阵

| 表 | 操作 | 条件 |
|---|---|---|
| `mesa_items` | `SELECT` | `tenant_id = app.tenant_id` |
| `mesa_items` | `INSERT` | 租户**且**（`owner_id = app.actor_id` 或控制台角色） |
| `mesa_items` | `UPDATE` | `USING` 与 `WITH CHECK` 同时要求租户**且** owner/角色 |
| `mesa_items` | `DELETE` | 租户**且** owner/角色 |
| `mesa_events` | `SELECT` | `tenant_id = app.tenant_id` |
| `mesa_events` | `INSERT` | `tenant_id = app.tenant_id` |
| `mesa_events` | `UPDATE` / `DELETE` | 无策略，也无表权限 |

控制台角色为 `admin`、`superadmin` 与 `ceo`（A-58）。`client_b2b` 只能写入 `owner_id` 等于其 `app.actor_id` 的行。未知或缺失的角色按无权限处理。

`mesa_items` 的 `SELECT` 是租户范围而非 owner 范围：细粒度可见性（Space 成员、分享、管理员）由 board API 应用。数据库保证任何租户都看不到其他租户的行。

`mesa_events` 没有 `UPDATE`/`DELETE`，`mesa_app` 也没有这些权限。即使将来误加策略，`GRANT` 仍会拒绝写入。

## `withTenant()`

```ts
import { withTenant } from './src/tenant.ts'

const rows = await withTenant(client, tenantId, async (tx) => {
  const result = await tx.query(
    `SELECT id, state FROM public.mesa_items ORDER BY created_at`,
  )
  return result.rows
}, { actorId, appRole: 'client_b2b' })
```

契约：

1. `BEGIN`。
2. `SET LOCAL ROLE mesa_app`（可用 `dbRole` 配置；`false` 则省略）。
3. `set_config('app.tenant_id', $1, true)`，并清理 actor/role。
4. 执行 `fn(tx)`。
5. `COMMIT`；任何错误都 `ROLLBACK` 并重新抛出原始错误。

`client` 必须是**预留的连接**（`pg.PoolClient`）。不要传 `pg.Pool`：`pool.query()` 可能为每条语句使用不同连接，`SET LOCAL` 会落到另一个会话。连接不得有已打开的事务，`fn` 不得执行 `COMMIT`、`ROLLBACK` 或开启另一个事务：`withTenant` 拥有事务边界。该助手拒绝对同一客户端的重入调用，以免提交外部事务。

PostgreSQL 不接受 `SET` 的参数，因此使用 `set_config('app.tenant_id', $1, true)`。`dbRole` 的名称在插值前用 `/^[A-Za-z_][A-Za-z0-9_]*$/` 校验；角色标识符无法参数化。

## `DATABASE_URL`

运行时：

```sh
DATABASE_URL=postgres://mesa_login:********@db.internal:5432/mesa
```

登录必须：

- 不是 `mesa_items` 或 `mesa_events` 的属主；
- 没有 `BYPASSRLS` 或 `SUPERUSER`；
- 是 `mesa_app` 的成员，并以 `SET LOCAL ROLE` 进入（`withTenant` 已做）；
- 每个事务使用预留连接。

`schema.sql` 由迁移角色（表属主）执行，而不是运行时登录。该角色需要在 `public` 创建对象、拥有表，并能创建/修改 `mesa_app`（`CREATEROLE`；设置 `NOBYPASSRLS` 需要超级用户）。生产环境用迁移任务应用架构，然后把 `DATABASE_URL` 交给 Mesa 进程。

## 测试

### 默认：PGlite（WASM 中的 PostgreSQL 17.5）

无需服务器、Docker 或网络：

```sh
cd packages/faberloom/board/postgres
npm install
npm test
```

PGlite 执行同一个 `schema.sql`，创建角色、应用 RLS，并遵守 `FORCE ROW LEVEL SECURITY`。结果：**41/41 通过**。测试覆盖：

- 引导的幂等性（总共应用三次）；
- board 与 API 的列、主键、复合外键、检查、索引与触发器；
- `(tenant_id, idempotency_key)` 的部分唯一索引；
- `mesa_app` 无 login/superuser/BYPASSRLS；
- items 的四个策略与 events 的两个策略；
- `SELECT`、`INSERT`、`UPDATE`、`DELETE` 上的 A/B 隔离；
- `client_b2b`、admin 与缺失 actor 的 `owner_id` 授权；
- `business_key` 的部分唯一性（存活 vs 终态，按租户）；
- 事件只追加：无 `UPDATE`/`DELETE`、复合外键、`seq` 重放；
- `withTenant`：提交、回滚、上下文重置、重入与校验。

### 真实 PostgreSQL 16（Docker）

```sh
cd packages/faberloom/board/postgres
docker compose -f docker-compose.test.yml up -d --wait

# PowerShell
$env:MESA_TEST_DATABASE_URL = "postgres://mesa_login:mesa_test@localhost:55432/mesa"
npm test

docker compose -f docker-compose.test.yml down -v
```

```sh
# bash
MESA_TEST_DATABASE_URL=postgres://mesa_login:mesa_test@localhost:55432/mesa npm test
```

Docker 的 init 会应用 `schema.sql` **两次**，并创建不继承权限的 `mesa_login`。测试把该 URL 当作真实登录而不是超级用户，因此也验证 `GRANT`/`REVOKE`。密码 `mesa_test` 仅用于这个一次性 compose，不在别处复用。

测试后端选择：

1. 若存在 `MESA_TEST_DATABASE_URL` 则用之；
2. 否则用 `DATABASE_URL`；
3. 若都没有 URL，则用内存 PGlite。

非本机 URL 会被拒绝，除非设置 `MESA_TEST_ALLOW_REMOTE=1`，以免误导出的生产 `DATABASE_URL` 执行破坏性测试。

### PGlite 的限制

PGlite 是编译到 WASM 的真实 PostgreSQL，单进程单连接。它验证 SQL、角色、`GRANT` 与 RLS 策略，但**不**验证：

- 连接之间的真实并发（`business_key` 竞争、锁、`SERIALIZABLE`）；
- wire protocol 认证、TLS、`pg_hba.conf` 或连接池；
- 扩展、副本、备份或 PITR；
- PostgreSQL 16 与 PGlite 17.5 之间的版本差异。

使用 `postgres:16-alpine` 的 Docker 泳道是这些点的参考。两个泳道共享同一 `schema.sql` 与同一组断言。

## 运维与演进

- **迁移**：`schema.sql` 是 v1 引导且幂等；不修改已有列。后续改动走 expand/contract 迁移（新列可空 → 回填 → 约束 → 清理），并附对账与回滚说明。
- **`updated_at`**：由触发器维护；应用不应信任客户端提交的值。
- **`row_version`**：由应用控制。`UPDATE` 必须包含 `WHERE tenant_id = ... AND id = ... AND row_version = $n`，并确认影响了一行；数据库不会自增。
- **删除**：`DELETE` 仅用于运维保留，但有事故事项不能删除（`ON DELETE RESTRICT`）。归档应先进入终态，再用独立保留策略。
- **审计**：`mesa_app` 不更新也不删除 `mesa_events`。若需保留策略，用管理角色与显式任务执行，绝不由应用执行。
- **控制台角色**：`admin`/`superadmin`/`ceo` 可在**租户内**写入任意 owner。需要跨租户的控制台角色需要其他机制（管理连接或显式扮演），本架构不授予。

## 数据库不决定的事

- `business_key` 的推导与 rekey。
- board 的状态机与哪些转换有效。
- Spaces 的归属与分享。
- 效果操作的授权与签名。
- 数据分类与 `payload` 脱敏。
- `mesa_events.actor` 与 `app.actor_id` 的对应：API 写入每个事件的操作者；数据库只保证事件属于事项所在租户。

这些仍在 API 与 board 服务中。数据库保证按租户隔离、写入时的 owner 授权、存活键唯一性与审计轨迹的不可变性。

## 与网关的集成

`gateway/board-api.mjs` **没有 DDL**。它读取本文件并用 `applyMesaSchema(target)` 应用，路径顺序为：

1. `options.schemaFile`；
2. `MESA_SCHEMA_FILE`；
3. `board-api.mjs` 旁的 `schema.sql`（镜像会复制到那里）；
4. `../packages/faberloom/board/postgres/schema.sql`（仓库）。

网关按此模型调整查询：

- `id`、`tenant_id`、`space_id` 与 `item_id` 是 `uuid`；`crypto.randomUUID()` 生成事项 id；
- 不是 UUID 的租户或 Space 被投影为确定性 UUIDv5，原值留在 `tenant_key` / `space_key`；
- `title`、`evidence`、`run_id` 与 `idempotency_key` 是本架构的列，而不是并行 DDL 的列；
- 每个事务执行 `SET LOCAL ROLE mesa_app` 并设置 `app.tenant_id`、`app.actor_id` 与 `app.role`；
- PATCH 与事件追加先用 SELECT 策略读取、授权，再用 `FOR UPDATE` 加锁，因为 UPDATE 策略是 owner 范围。

由网关旧 DDL 创建的数据库把 `tenant_id`/`id` 设为 `text`。引导脚本会检测并以明确消息失败：必须重建或迁移为 `uuid` 后再启用 API。`CREATE TABLE IF NOT EXISTS` 不会转换类型。

## 文件

```
packages/faberloom/board/postgres/
├── schema.sql                  bootstrap idempotente + RLS + grants
├── src/tenant.ts               withTenant(): transacción con contexto
├── src/index.ts                re-export
├── tests/support/db.ts         backend PGlite/Postgres y helpers
├── tests/schema.test.ts        contrato, idempotencia, catálogo
├── tests/tenant.test.ts        contexto, commit, rollback, reentrancia
├── tests/isolation.test.ts     aislamiento A/B y autorización de owner
├── tests/events.test.ts        append-only, FK, replay
├── docker/00-init.sql          init de PG16: schema x2 + login sin herencia
└── docker-compose.test.yml     PostgreSQL 16 para el lane real
```

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

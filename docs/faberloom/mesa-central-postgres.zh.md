# 中央 Mesa 的 PostgreSQL 数据库

[English](mesa-central-postgres.md) | 中文

`faberloom_mesa` 是 VPS 上 Mesa（方案 A）的中央数据库：租户是隔离边界，由 PostgreSQL 的 Row Level Security 强制执行。本页记录它的创建结果、Alejandro 的 460 个事项的首次导入，以及执行过程中暴露的三个仓库缺陷。

## 结果

- `consola-mwt-one-postgres` 容器（PostgreSQL 16.15）中的 `faberloom_mesa` 数据库，属主为 `mesa_migrator`；控制台数据库（`mwt_one`）未被改动。
- `schema.sql` 连续执行五次均无错误：初始引导、收敛到当前含 16 列与 7 个索引的版本，以及数据载入后的最后一次执行。
- 460 个事项与 2413 条事件导入到单一租户（`5525986c-3b09-4d13-bf8f-43ccaa2deae3`），没有孤立事件。
- 用两个租户验证隔离：A 返回 460 个事项和 2413 条事件，B 返回零行，带外部租户的 `INSERT` 被 RLS 拒绝。
- 运行时凭据位于 `/opt/mwt-one-harness/.env.mesa`，权限 600，属主 `root:root`。

## 角色与属主

| 角色 | 属性 | 职责 |
|---|---|---|
| `mesa_migrator` | `NOLOGIN`、`CREATEROLE`、无 `BYPASSRLS` | 数据库、`mesa_items` 与 `mesa_events` 的属主；执行 schema |
| `mesa_app` | `NOLOGIN`、无 `BYPASSRLS`、无 `CREATEROLE` | 应用的组角色，也是所有 RLS 策略的作用对象 |
| `mesa_login` | `LOGIN`、`NOINHERIT`、无 `BYPASSRLS` | 唯一的运行时登录，用 `SET LOCAL ROLE mesa_app` 进入组角色 |

`mesa_app` 不能登录，`mesa_login` 不继承任何权限，因此缺少 `SET LOCAL ROLE mesa_app` 时每条语句都以 `permission denied` 失败：这正是设计要求的失败关闭行为。`REVOKE ALL ON DATABASE ... FROM PUBLIC` 还要求显式把 `CONNECT` 授予 `mesa_login`。

## 导入 460 个事项

```sh
# MESA_URL: login de runtime más options=-c role=mesa_app -c app.role=admin
node scripts/migrate-board-postgres.mjs \
  --file "$BOARD_JSON" \
  --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_URL"
```

导入以 `mesa_login` 身份、在建立连接时进入 `mesa_app` 执行，因此 RLS 策略真正生效；以超级用户执行则会绕过它们。URL 保存在 600 文件中，不出现在命令行上。再次执行后计数不变：事项按 `(tenant_id, id)` upsert，事件使用 `ON CONFLICT DO NOTHING`。

## 隔离验证

```sql
BEGIN;
SET LOCAL ROLE mesa_app;
SELECT set_config('app.tenant_id', '5525986c-3b09-4d13-bf8f-43ccaa2deae3', true),
       set_config('app.actor_id', 'alejandro@muitowork.com', true),
       set_config('app.role', 'client_b2b', true);
SELECT count(*) FROM mesa_items;
SELECT count(*) FROM mesa_events;
ROLLBACK;
```

换成租户 B（`00000000-0000-4000-8000-000000000001`）后，同样的 `SELECT` 返回零行，即使按租户 A 的 `tenant_id` 过滤也是如此。带外部 `tenant_id` 的 `INSERT` 以 `new row violates row-level security policy for table "mesa_items"` 失败；在 `mesa_events` 上，`UPDATE`、`DELETE` 和 `TRUNCATE` 都以 `permission denied` 失败。没有 `app.tenant_id` 时 `SELECT` 返回零行；事务结束后，角色与会话上下文一并消失。

## 仓库缺陷

1. `schema.sql` 无法用 README 所述的迁移角色执行：在 PostgreSQL 16 上 `ALTER ROLE mesa_app ... NOSUPERUSER` 需要 `SUPERUSER`，会以 `permission denied to alter role` 失败。实际做法是以集群管理员执行，然后把表与函数的属主移交给 `mesa_migrator`。
2. `migrate-board-postgres.mjs` 把缺失的 `businessKey` 变成空字符串，违反 `mesa_items_business_key_not_blank`。Alejandro 的看板中 460 个事项里有 436 个既无 `businessKey` 也无 `sourceRef`，`rekeyAll` 把它们视为「没有身份」。这些行以临时键 `legacy:<事项 id>` 导入，该键由不可变的 UUID 推导而来，其余 24 行保留真实键。
3. 脚本在自己的事务里设置 `app.actor_id` 与 `app.role`，但不进入 `mesa_app`：它不执行 `SET LOCAL ROLE`。使用不带 `options=-c role=mesa_app` 的 `mesa_login` URL 时，第一次写入就以 `permission denied for table mesa_items` 失败。建议脚本自行执行该 `SET LOCAL ROLE`，或把该选项写进 URL 的文档。

## 运维

```sh
docker exec -i consola-mwt-one-postgres psql -U mwt -d faberloom_mesa -v ON_ERROR_STOP=1
```

- 应用的所有写入都用 `SET LOCAL ROLE mesa_app` 加三个会话变量，`withTenant()` 已经这样做。
- `/opt/mwt-one-harness` 目录权限是 0777：本地用户可以替换 `.env.mesa`，即使该文件本身是 600。建议收紧目录权限。
- `faberloom_mesa` 目前既没有备份也没有按时间点恢复；需要确定 RPO 与 RTO，并做一次真实的恢复演练。

## 启用（2026-11-02）

- 网关以 `FABERLOOM_BOARD_API=1` 和 `mesa_login` 的 `DATABASE_URL` 挂载 `/board`；无会话返回 `401`，`startInstance` 为每个用户签发的 HMAC 令牌可作为 `Authorization: Bearer` 使用。
- 共享 Mesa（A）：`FABERLOOM_BOARD_TENANT=5525986c-3b09-4d13-bf8f-43ccaa2deae3`。Alejandro 与 Álvaro 收到同一租户；用真实令牌调用 API，双方返回同一集合（收尾验证时为 481：460 个迁移事项加上 `on` 之后例程创建的 21 个），每页 200 分页。
- 按实体的跨租户（B）：令牌携带 `tenantIds`，请求用 `x-board-tenant` 选择实体；管理员可切换自己的另一实体，`client_b2b` 收到 `403 NO_ACCESS`。
- 在一次性租户上对真实 PostgreSQL 验证写入：创建 `201`、带严重级别批准 `200`、无严重级别批准 `422 SEVERITY_REQUIRED`、从终态转换 `409 TERMINAL_STATE`、带空间迭代 `200 ITERANDO`，审计记录 `created`/`approve`。
- `on` 模式：board 在进程内运行状态机、控制项、候选版本与迭代锁，并持久化完整记录；SQLite 作为备份，接收每次提交的副本。每个用户的 `dsh` 都带 `FABERLOOM_BOARD_REMOTE=on`、内部 URL、租户与其令牌。
- `healthz` 返回 `ok`，且 `manifestDrift=false`。
- 身份：`legacy:<uuid>` 是 436 个未声明 `sourceRef` 的事项的永久规范键（[ADR-007](../../ADRs_MESA/ADR-007-identidad-mesa.md)）。采用 `documentRef`/`evidence` 会把 436 个事项压缩成 123 个引用和 313 次冲突，因此不采用。rekey 后 0 个存活重复键。
- 备份：每 15 分钟 `pg_dump -Fc`，用 sha256 + `pg_restore --list` 验证，保留 30 天，并有每周演练将备份恢复到一次性数据库（[ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md)）。
- 审计与 outbox：`POST /board/items/:id/access` 把 N3/N4 访问写入 `mesa_events`；outbox 仍是按进程的租约队列，但它触及的每个事项都在 Mesa 中读写（[ADR-009](../../ADRs_MESA/ADR-009-outbox-y-auditoria-mesa.md)）。

## 待办

- 修正 `schema.sql` 中的 `ALTER ROLE`，使 `CREATEROLE` 角色也能执行该文件。
- 从导入行的 `payload` 回填 `title`、`run_id` 与 `idempotency_key`，或确认 API 在这些列为 `NULL` 时回退到 `payload`。

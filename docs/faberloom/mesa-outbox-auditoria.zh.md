# 中央 Mesa 的效果 outbox 与访问审计

[English](mesa-outbox-auditoria.md) | 中文

当 `FABERLOOM_BOARD_REMOTE=on` 时，事项存放在中央 Mesa（`mesa_items` + `mesa_events`），进程的 SQLite 作为备份。本文说明每个操作走哪条路径、outbox 保证什么，以及还剩哪些限制。决策与备选方案见 [ADR-009](../../ADRs_MESA/ADR-009-outbox-y-auditoria-mesa.md)。

## 哪些进入 Mesa，哪些留在进程

| 操作 | `off` / `shadow` | `on` |
|---|---|---|
| `list`、`get` | SQLite（`shadow` 还会比较） | Mesa（`GET /board/items`、`GET /board/items/:id`） |
| `create`、`submit` | SQLite | Mesa（`POST /board/items`），使用相同 `id`；保留本地副本 |
| 六个状态命令 | SQLite | Mesa（带 `command` 的 `PATCH /board/items/:id`）；保留本地副本 |
| `noteAccess`（N3/N4） | 本地事件 | `POST /board/items/:id/access` → `mesa_events` |
| outbox 的预留、消息与告警 | SQLite | SQLite（进程的工作队列） |
| outbox 触及的事项 | SQLite | Mesa（读写）；保留本地副本 |

本地备份接收每次远程提交的完整记录。若该写入失败，只记录警告，不撤销远程提交：Mesa 已经是事实来源。

## N3/N4 访问审计

`noteAccess(actor, id, detail)` 先从 Mesa 读取事项并应用 board 的读取规则。若数据级别不是 `N3` 或 `N4`，则不写入任何内容。

在 `on` 下，board 调用 `POST /board/items/:id/access`，请求体为 `{ detail }`，不含身份：

- 操作者来自进程凭据。该路由对请求体中的 `email`、`ownerId`、`tenantId` 与 `role` 返回 `400 INVALID_INPUT`；像 `actor` 这样的未知字段被忽略，事件仍记录会话的操作者。
- 只有获得授权的读者才产生审计：事项属主或租户管理员。同一租户内他人的 `client_b2b` 收到 `403 NO_ACCESS`；其他租户收到 `404 NOT_FOUND`，不确认事项是否存在。
- 每个操作者、事项与小时最多一个事件。检查发生两次：加锁前一次，取得事项的 `SELECT … FOR UPDATE` 后再一次，因此两个进程不会插入同一操作者/小时组合。
- 插入时返回 `201 { event, recorded: true }`，该小时已有事件时返回 `200 { event, recorded: false }`。`seq` 在事项锁内用 `MAX(seq)+1` 分配。
- 不增加 `rowVersion`：读取不是命令，也不应让已打开的标签页失效。

在 `off` 与 `shadow` 下，一小时窗口仍按本地记录的事件计算，行为不变。

## outbox 消费

队列属于进程：`effect_reservations`、`effect_outbox` 与 `effect_alerts` 存放在本地存储。队列触及的事项始终是 Mesa 中的那一行。

`dispatchEffect(actor, effectKey)`：

1. 读取本地消息，要求其可派发（`PENDIENTE`、`dispatchable`）。
2. 用感知模式的读取器读取事项：`on` 下为 `GET /board/items/:id`。远程 `NOT_FOUND` 以 `ITEM_MISSING` 取消消息；传输失败以 `REMOTE_UNAVAILABLE` 传播，消息保持待处理。
3. 若回滚窗口仍开启，返回 `WINDOW_OPEN` 且不发送。若已关闭，`expireForDispatch` 通过 `commitItem` 持久化 `window.expired`：`on` 下是一次发往 Mesa 的 `PATCH`，本地备份接收镜像。
4. 要求 `EJECUCION_PENDIENTE` 以及同一执行的 `RESERVADA` 预留。
5. 重新校验控制项并再次读取事项；若已变化，返回 `STALE_REVALIDATION` 且不发送。
6. 调用适配器之前先认领消息（`DESPACHADO`、`dispatchable: false`），并把预留标记为 `DESPACHADA`。
7. 发送，用 `commitItem` 把结果写回事项（`on` 下写 Mesa），并在本地结清消息与预留。

同一效果的两次派发：第二次发现消息已是 `DESPACHADO`，返回 `OUTBOX_NOT_PENDING`，不调用适配器。

`recoverOrphanedReservations(actor)` 也从 Mesa 读取事项：`on` 下遍历 `GET /board/items`，收集事项记录的 `effectKey`。只要键仍在 Mesa 中，即使本地备份没有该行，预留也不会被释放。

## 失败

| 情况 | 对事项的影响 | 对消息的影响 |
|---|---|---|
| 消费者读取时 Mesa 无响应 | 无 | 保持 `PENDIENTE`；错误向上传播 |
| 事项已不在 Mesa | 无 | 以 `ITEM_MISSING` 置为 `CANCELADO` |
| 回滚窗口仍开启 | 无 | 保持 `PENDIENTE`；稍后重试 |
| 重新校验时有阻塞控制项失败 | 回到 `PENDIENTE_CRITERIO`，清除 `effectKey` | 以 `REVALIDATION_FAILED` 置为 `CANCELADO` |
| 读取与重新校验之间事项被改动 | 保留其他操作者的改动 | 保持 `PENDIENTE`；稍后重试 |
| 适配器无响应 | `DESCONOCIDO` | 以 `OUTCOME_UNKNOWN` 置为 `DESPACHADO`；只有 `reconcile` 能关闭 |
| 访问审计无法写入 | 无；读取以远程错误失败 | 不适用 |

## 限制

- **队列不跨进程存活。** 若进程在受理与派发之间死亡，其他进程看不到该消息。Mesa 事项保留 `effectKey`、`executionId`、`actionType`、`reversalDeadline`，以及带 `destination` 与 `idempotencyKey` 的 `effect.accepted` 事件，因此消息可重建；自动重建尚未实现。
- **队列与目标不是原子的。** 消息在调用适配器前变为 `DESPACHADO`；认领与响应之间的崩溃会留下未确认的预留，由 `reconcile` 处理。
- **访问审计不复制到备份。** `on` 下事件存放在 `mesa_events`；从本地 SQLite 读取看不到它，这正是预期行为。
- **`shadow` 不向 Mesa 写审计。** 它只比较读取；为避免观察期间写入，访问审计仍留在本地。

## 验证

```sh
npx tsc -p packages/faberloom/board/tsconfig.json --noEmit
npx vitest run packages/faberloom/board/tests
node --test gateway/board-api.test.mjs
```

远程访问与"事项只在 Mesa 中"的派发测试位于 `packages/faberloom/board/tests/remote-outbox.spec.ts`；去重与拒绝请求体身份位于 `gateway/board-api.test.mjs`。
